// Frontend mirror of /api/twitch/me responses.

export type TwitchLinkStatus =
  | { connected: false }
  | {
      connected: true;
      broadcasterId: string;
      login: string;
      displayName: string;
      scopes: string[];
      connectedAt: number;
    };

export type EventSubConnectionStatus =
  | "disconnected"
  | "connecting"
  | "welcomed"
  | "subscribed"
  | "stopping";

export interface EventSubStatusPayload {
  broadcasterId: string;
  status: EventSubConnectionStatus;
  sessionId: string | null;
  subscribedTypes: string[];
  lastEventAt: number | null;
  lastEventType: string | null;
  lastError: string | null;
}

export type EffectApplicability =
  | "always"
  | "during_run"
  | "before_run"
  | "during_run_powerups";

export interface EffectStatus {
  key: string;
  title: string;
  prompt: string;
  channelPointCost: number | null;
  bitsCost: number | null;
  applicableWhen: EffectApplicability;
  reward: { rewardId: string; cost: number; enabled: boolean } | null;
}

export type TwitchFullStatus =
  | { connected: false }
  | {
      connected: true;
      broadcasterId: string;
      login: string;
      displayName: string;
      eventsub: EventSubStatusPayload;
      effects: EffectStatus[];
      autoCategory: boolean;
      /** False when the linked token doesn't carry the channel:manage:broadcast
       *  scope — the user must reconnect Twitch before the toggle has effect. */
      canAutoCategory: boolean;
    };

export interface TwitchEvent {
  id: number;
  broadcasterId: string;
  receivedAt: number;
  source: "channel_points" | "bits";
  effectKey: string | null;
  applied: boolean;
  failReason: string | null;
  userLogin: string | null;
  bits: number | null;
  rewardTitle: string | null;
}
