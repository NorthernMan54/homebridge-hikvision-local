import { EventEmitter } from 'events';

/**
 * Parses multipart-style stream parts that include `Content-Length` headers.
 * Emits `message` events with { headers, body }.
 */
export class MultipartXmlStreamParser extends EventEmitter {
  private buffer = '';
  private processing = false;

  public write(chunk: string | Buffer): void {
    this.buffer += chunk.toString('utf8');
    if (!this.processing) {
      this.processing = true;
      this.processBuffer();
    }
  }

  private processBuffer(): void {
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) {
        break;
      }

      const rawHeaders = this.buffer.slice(0, headerEnd);
      const headers = this.parseHeaders(rawHeaders);
      const contentLength = parseInt(headers['content-length'] || '', 10);
      if (isNaN(contentLength)) {
        this.emit('error', new Error('Missing or invalid Content-Length header'));
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }

      const totalLength = headerEnd + 4 + contentLength;
      if (this.buffer.length < totalLength) {
        break;
      }

      const body = this.buffer.slice(headerEnd + 4, totalLength);
      this.emit('message', {
        headers,
        body: body.trim(),
      });

      this.buffer = this.buffer.slice(totalLength);
    }

    this.processing = false;
  }

  private parseHeaders(headerText: string): Record<string, string> {
    const headers: Record<string, string> = {};
    const lines = headerText.split('\r\n');

    for (const line of lines) {
      const sep = line.indexOf(':');
      if (sep !== -1) {
        const key = line.slice(0, sep).trim().toLowerCase();
        const value = line.slice(sep + 1).trim();
        headers[key] = value;
      }
    }

    return headers;
  }
}

export interface ParsedPart {
  headers: Record<string, string>;
  body: string;
}
