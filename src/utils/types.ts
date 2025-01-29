import type { CrossChainAction } from "@across-protocol/app-sdk";
import type { Address } from "viem";

export interface CrossChainMessage {
  actions: CrossChainAction[];
  fallbackRecipient: Address;
}
