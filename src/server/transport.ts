/**
 * Custom HTTP Transport for MCP over Azure Web Service
 * Implements direct JSON responses (not SSE streaming) for Azure orchestrator compatibility
 * CRITICAL: Includes server.connect() call for proper MCP protocol lifecycle
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage, JSONRPCRequest } from '@modelcontextprotocol/sdk/types.js';
import type { Express, Request, Response } from 'express';
import { apiRateLimiter } from '../middleware/rateLimiter.js';
import type { XppServerContext } from '../types/context.js';

export class CustomHttpTransport implements Transport {
  private server: Server;
  private app: Express;
  private context: XppServerContext;
  private currentResponse: Response | null = null;
  private pendingRequests = new Map<string | number, (message: JSONRPCMessage) => void>();

  // Transport interface properties
  onmessage?: (message: JSONRPCMessage) => void;
  onerror?: (error: Error) => void;
  onclose?: () => void;

  constructor(server: Server, app: Express, context: XppServerContext) {
    this.server = server;
    this.app = app;
    this.context = context;
    
    this.setupRoutes();
    
    // Connect server immediately (must be done before handling requests)
    this.connectServer().catch(err => {
      process.stderr.write(`Failed to connect server: ${err}\n`);
    });
  }

  /**
   * Connects MCP server to this transport
   * CRITICAL: Must be called for proper protocol lifecycle and completion signaling
   */
  async connectServer(): Promise<void> {
    await this.server.connect(this);
  }

  // Transport interface methods
  async start(): Promise<void> {
    // HTTP transport doesn't need explicit start
  }

  async close(): Promise<void> {
    this.currentResponse = null;
    this.pendingRequests.clear();
  }

  async send(message: JSONRPCMessage): Promise<void> {
    // If this is a response to a request (has id), resolve the pending promise
    if ('id' in message && message.id !== undefined && message.id !== null) {
      const resolver = this.pendingRequests.get(message.id);
      if (resolver) {
        resolver(message);
        this.pendingRequests.delete(message.id);
        return;
      }
    }
    
    // Fallback: send via currentResponse if available
    if (this.currentResponse && !this.currentResponse.headersSent) {
      this.currentResponse.json(message);
      this.currentResponse = null;
    }
  }

  private setupRoutes(): void {
    // Apply rate limiting
    this.app.use('/mcp', apiRateLimiter);

    // MCP endpoint - direct JSON-RPC
    this.app.post('/mcp', async (req: Request, res: Response): Promise<void> => {
      try {
        // Disable Keep-Alive to close connection after each response
        res.setHeader('Connection', 'close');
        
        const request = req.body as JSONRPCRequest;
        
        if (!request.jsonrpc || !request.method) {
          res.status(400).json({
            jsonrpc: '2.0',
            error: {
              code: -32600,
              message: 'Invalid Request: missing jsonrpc or method',
            },
            id: null,
          });
          return;
        }

        // Store response object for send() method
        this.currentResponse = res;

        // Handle notifications (no response expected)
        if (!('id' in request)) {
          // Handle special notifications
          if ((request as any).method === 'notifications/cancelled' || 
              (request as any).method === 'cancelled' ||
              (request as any).method === 'shutdown') {
            // Send 202 and signal completion
            res.status(202).json({ status: 'accepted', completed: true });
            this.currentResponse = null;
            
            // Trigger cleanup after response is sent
            setImmediate(() => {
              if (this.onclose) {
                this.onclose();
              }
            });
            return;
          }
          
          if (this.onmessage) {
            this.onmessage(request);
          }
          res.status(202).json({ status: 'accepted' });
          this.currentResponse = null;
          return;
        }

        // Handle requests - send to MCP server via onmessage
        // Wait for response via Promise
        if (this.onmessage) {
          // Log incoming request
          const toolName = (request as any).params?.name || request.method;
          const args = (request as any).params?.arguments;
          const argsSummary = args ? ` (${Object.keys(args).join(', ')})` : '';
          process.stdout.write(`\n→ ${toolName}${argsSummary}\n`);

          const responsePromise = new Promise<JSONRPCMessage>((resolve, reject) => {
            this.pendingRequests.set(request.id, resolve);
            
            // Timeout after 30 seconds
            setTimeout(() => {
              if (this.pendingRequests.has(request.id)) {
                this.pendingRequests.delete(request.id);
                reject(new Error('Request timeout'));
              }
            }, 30000);
          });

          // Send request to MCP server
          this.onmessage(request);
          
          // Wait for response from send()
          const response = await responsePromise;
          
          // Log response
          if ('result' in response) {
            const content = (response as any).result?.content?.[0]?.text;
            if (content) {
              const firstLine = content.split('\n')[0].substring(0, 80);
              process.stdout.write(`← ${firstLine}\n`);
            } else {
              process.stdout.write(`← Success\n`);
            }
          } else if ('error' in response) {
            const errorMsg = (response as any).error?.message || 'Unknown error';
            process.stdout.write(`← Error: ${errorMsg.substring(0, 80)}\n`);
          }
          
          res.json(response);
          this.currentResponse = null;
        } else {
          res.status(500).json({
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message: 'Transport not connected',
            },
            id: request.id,
          });
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        process.stderr.write(`← Transport error: ${errorMsg}\n`);
        this.currentResponse = null;
        
        // Clean up pending request if it exists
        if ('id' in (req.body as any)) {
          this.pendingRequests.delete((req.body as any).id);
        }
        
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message: error instanceof Error ? error.message : 'Internal error',
            },
            id: null,
          });
        }
      }
    });

    // Health check
    this.app.get('/health', (_req: Request, res: Response) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        symbols: this.context.symbolIndex.getSymbolCount(),
      });
    });
  }
}

// Factory function
export function createStreamableHttpTransport(
  server: Server,
  app: Express,
  context: XppServerContext
): CustomHttpTransport {
  return new CustomHttpTransport(server, app, context);
}

