import type { ReplayDataGateway } from "../../application/controllers/replay-viewer-controller";
import type { RawRrrocketReplay } from "../../replay/types";
import { parseRrrocketReplay } from "../../replay/rrrocket-adapter";
import { replayAnalysisBundleV2Schema, type ReplayAnalysisBundleV2 } from "../../shared/contracts/replay-analysis-v2";

export class HttpReplayDataGateway implements ReplayDataGateway {
  constructor(private readonly request: typeof fetch = fetch) {}

  async load(url: string): Promise<RawRrrocketReplay> {
    const response = await this.request(url);
    if (!response.ok) throw new Error(`Could not load ${url}`);
    return parseRrrocketReplay(await response.json());
  }

  async loadBundle(url: string): Promise<ReplayAnalysisBundleV2> {
    const response = await this.request(url);
    if (!response.ok) throw new Error(`Could not load ${url}`);
    return replayAnalysisBundleV2Schema.parse(await response.json());
  }
}
