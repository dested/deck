// Binary bridge to /ws/term/:id. Server sends binary frames (PTY bytes) and
// text frames (JSON control: ready/exit). We send JSON input/resize.
export interface TermSocketHandlers {
  onData: (bytes: Uint8Array) => void;
  onReady?: () => void;
  onExit?: (code: number | null) => void;
  onOpen?: () => void;
  onClose?: () => void;
}

export class TermSocket {
  private ws: WebSocket | null = null;
  private closed = false;
  private queue: string[] = [];

  constructor(
    private readonly id: string,
    private readonly handlers: TermSocketHandlers,
  ) {
    this.open();
  }

  private open() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws/term/${this.id}`);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onopen = () => {
      this.handlers.onOpen?.();
      for (const m of this.queue) ws.send(m);
      this.queue = [];
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") {
        try {
          const msg = JSON.parse(ev.data) as { op: string; code?: number | null };
          if (msg.op === "ready") this.handlers.onReady?.();
          else if (msg.op === "exit") this.handlers.onExit?.(msg.code ?? null);
        } catch {
          /* ignore */
        }
      } else {
        this.handlers.onData(new Uint8Array(ev.data as ArrayBuffer));
      }
    };
    ws.onclose = () => {
      this.handlers.onClose?.();
    };
    ws.onerror = () => ws.close();
  }

  private send(obj: unknown) {
    const s = JSON.stringify(obj);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(s);
    else this.queue.push(s);
  }

  input(data: string) {
    this.send({ op: "input", data });
  }

  resize(cols: number, rows: number) {
    this.send({ op: "resize", cols, rows });
  }

  close() {
    this.closed = true;
    this.ws?.close();
    this.ws = null;
  }

  get isClosed() {
    return this.closed;
  }
}
