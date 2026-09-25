export type TrafficClass =
  "human" | "confirmed_bot" | "probable_bot" | "unknown";
export type BotProvider =
  "meta" | "whatsapp" | "google" | "bing" | "other" | "unknown";
export interface TrafficAssessment {
  classification: TrafficClass;
  is_bot: boolean | null;
  /** Ordinal automation confidence, 0–100, not a calibrated probability. */
  bot_confidence: number | null;
  /** Probable attribution; not verified provider identity. */
  bot_provider: BotProvider;
  bot_reason: string[];
  classifier_version: number | null;
  traffic_signals: Record<string, string | number | boolean | number[] | null>;
}
export interface AccessLog extends TrafficAssessment {
  id: number;
  link_id: string;
  link_name: string;
  slug: string;
  hostname: string;
  device: "mobile" | "desktop";
  destination: "real" | "waiting";
  country: string;
  created_at: string;
  user_agent: string | null;
  ip: string | null;
  asn: number | null;
  request_method: string;
  referer: string | null;
  cf_ray: string | null;
}
export interface TrafficSummary {
  total: number;
  real: number;
  waiting: number;
  mobile: number;
  automated: number;
  automated_percent: number;
}
