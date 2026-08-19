import type { InterpolatedReplayState, ReplayCar, Vector3Data } from "../../../replay/types";
import type { RenderContext, ReplayRenderer } from "../types";

const FIELD_X = 4096;
const FIELD_Y = 5120;
const CORNER_RADIUS = 1792;
const BLUE = "#43a5ff";
const ORANGE = "#ff914d";
const BOOST_PADS = [
  { x: -3584, y: 0 }, { x: 3584, y: 0 },
  { x: -3584, y: -4096 }, { x: 3584, y: -4096 },
  { x: -3584, y: 4096 }, { x: 3584, y: 4096 },
];

interface FieldLayout {
  cx: number;
  cy: number;
  scale: number;
  width: number;
  height: number;
}

export class CanvasReplayRenderer implements ReplayRenderer {
  private readonly context: CanvasRenderingContext2D;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("2D canvas rendering is unavailable.");
    this.context = context;
  }

  render(state: InterpolatedReplayState, _context: RenderContext): void {
    this.resize();
    const layout = this.fieldLayout();
    this.context.save();
    this.drawField(layout);
    for (const car of state.cars) this.drawCar(car, layout);
    for (const car of _context.ghostCars) this.drawCar(car, layout, true);
    this.drawBall(state.ball, layout);
    this.context.restore();
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(rect.height * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  dispose(): void {}

  private fieldLayout(): FieldLayout {
    const pad = Math.min(this.canvas.width, this.canvas.height) * 0.055;
    const scale = Math.min(
      (this.canvas.width - pad * 2) / (FIELD_Y * 2 + 1300),
      (this.canvas.height - pad * 2) / (FIELD_X * 2),
    );
    return {
      cx: this.canvas.width / 2,
      cy: this.canvas.height / 2,
      scale,
      width: FIELD_Y * 2 * scale,
      height: FIELD_X * 2 * scale,
    };
  }

  private point(x: number, y: number, layout: FieldLayout): { x: number; y: number } {
    return { x: layout.cx + y * layout.scale, y: layout.cy - x * layout.scale };
  }

  private roundedRect(x: number, y: number, width: number, height: number, radius: number): void {
    this.context.beginPath();
    this.context.roundRect(x, y, width, height, radius);
  }

  private drawField(layout: FieldLayout): void {
    const { cx, cy, width, height, scale } = layout;
    const context = this.context;
    context.fillStyle = "#07100e";
    context.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const x = cx - width / 2;
    const y = cy - height / 2;
    this.roundedRect(x, y, width, height, CORNER_RADIUS * scale);
    const gradient = context.createLinearGradient(0, y, 0, y + height);
    gradient.addColorStop(0, "#183c36");
    gradient.addColorStop(0.5, "#17372f");
    gradient.addColorStop(1, "#153936");
    context.fillStyle = gradient;
    context.fill();
    context.clip();
    const stripeWidth = 1024 * scale;
    for (let index = 0; index < 10; index += 2) {
      context.fillStyle = "rgba(255,255,255,.018)";
      context.fillRect(x + index * stripeWidth, y, stripeWidth, height);
    }
    context.fillStyle = "rgba(67,165,255,.045)";
    context.fillRect(x, y, width / 2, height);
    context.fillStyle = "rgba(255,145,77,.045)";
    context.fillRect(cx, y, width / 2, height);
    context.strokeStyle = "rgba(224,246,238,.32)";
    context.lineWidth = Math.max(1, 8 * scale);
    context.beginPath();
    context.moveTo(cx, y);
    context.lineTo(cx, y + height);
    context.stroke();
    context.beginPath();
    context.arc(cx, cy, 915 * scale, 0, Math.PI * 2);
    context.stroke();
    context.fillStyle = "rgba(235,255,248,.5)";
    context.beginPath();
    context.arc(cx, cy, Math.max(2, 35 * scale), 0, Math.PI * 2);
    context.fill();
    for (const pad of BOOST_PADS) {
      const point = this.point(pad.x, pad.y, layout);
      const radius = Math.max(4, 78 * scale);
      context.fillStyle = "rgba(255,183,58,.32)";
      context.beginPath();
      context.arc(point.x, point.y, radius * 1.65, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#ffc04a";
      context.strokeStyle = "rgba(255,246,198,.9)";
      context.lineWidth = Math.max(1, 7 * scale);
      context.beginPath();
      context.arc(point.x, point.y, radius, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }
    context.restore();
    context.strokeStyle = "rgba(225,246,240,.58)";
    context.lineWidth = Math.max(1.5, 12 * scale);
    this.roundedRect(x, y, width, height, CORNER_RADIUS * scale);
    context.stroke();
    const goalWidth = 1786 * scale;
    const goalDepth = 650 * scale;
    context.lineWidth = Math.max(1.5, 10 * scale);
    context.strokeStyle = ORANGE;
    context.strokeRect(x + width, cy - goalWidth / 2, goalDepth, goalWidth);
    context.strokeStyle = BLUE;
    context.strokeRect(x - goalDepth, cy - goalWidth / 2, goalDepth, goalWidth);
  }

  private drawCar(car: Pick<ReplayCar, "x" | "y" | "name" | "team" | "yaw">, layout: FieldLayout, ghost = false): void {
    const context = this.context;
    const point = this.point(car.x, car.y, layout);
    const length = Math.max(16, 310 * layout.scale);
    const width = Math.max(9, 180 * layout.scale);
    context.save();
    context.translate(point.x, point.y);
    context.rotate(car.yaw - Math.PI / 2);
    context.globalAlpha = ghost ? 0.34 : 1;
    context.shadowColor = ghost ? (car.team === 0 ? BLUE : ORANGE) : "rgba(0,0,0,.55)";
    context.shadowBlur = ghost ? 20 : 8;
    context.shadowOffsetY = ghost ? 0 : 4;
    this.roundedRect(-length / 2, -width / 2, length, width, width * 0.28);
    context.fillStyle = car.team === 0 ? BLUE : ORANGE;
    context.fill();
    context.shadowColor = "transparent";
    context.strokeStyle = "rgba(255,255,255,.72)";
    context.lineWidth = Math.max(1, layout.scale * 9);
    context.stroke();
    context.fillStyle = "#f7fbff";
    context.beginPath();
    context.moveTo(length * 0.57, 0);
    context.lineTo(length * 0.28, -width * 0.32);
    context.lineTo(length * 0.28, width * 0.32);
    context.closePath();
    context.fill();
    context.restore();
    context.font = `700 ${Math.max(10, 145 * layout.scale)}px system-ui`;
    context.textAlign = "center";
    context.textBaseline = "bottom";
    context.lineWidth = 3;
    context.strokeStyle = "rgba(6,10,15,.9)";
    context.strokeText(car.name, point.x, point.y - width * 0.8);
    context.fillStyle = "#fff";
    context.fillText(car.name, point.x, point.y - width * 0.8);
  }

  private drawBall(ball: Vector3Data | null, layout: FieldLayout): void {
    if (!ball) return;
    const context = this.context;
    const point = this.point(ball.x, ball.y, layout);
    const radius = Math.max(7, 92 * layout.scale);
    const lift = Math.min(18, Math.max(0, ball.z - 93) * layout.scale * 0.08);
    context.fillStyle = `rgba(0,0,0,${Math.max(0.12, 0.42 - ball.z / 6000)})`;
    context.beginPath();
    context.ellipse(point.x, point.y, radius * 1.1, radius * 0.7, 0, 0, Math.PI * 2);
    context.fill();
    const gradient = context.createRadialGradient(point.x - radius * 0.35, point.y - lift - radius * 0.4, 1, point.x, point.y - lift, radius);
    gradient.addColorStop(0, "#fff");
    gradient.addColorStop(0.4, "#e8edf1");
    gradient.addColorStop(1, "#7e8992");
    context.fillStyle = gradient;
    context.strokeStyle = "#101820";
    context.lineWidth = Math.max(1.5, radius * 0.14);
    context.beginPath();
    context.arc(point.x, point.y - lift, radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }
}
