import { Mastra } from "@mastra/core";
import { assistantAgent } from "./agents/assistantAgent";

import { handsonworkflow } from "./workflows/handson";

export const mastra = new Mastra({
  agents: { assistantAgent },
  // 作成したワークフローを追加
  workflows: { handsonworkflow },
});
