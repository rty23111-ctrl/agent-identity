import competitiveDeepDive from "../COMPETITIVE_DEEP_DIVE.md";
import financialProjections from "../FINANCIAL_PROJECTIONS.md";
import salesPackage from "../SALES_PACKAGE.md";
import pitchDeckOutline from "../PITCH_DECK_OUTLINE.md";

export type MarkdownDoc = {
  id: string;
  title: string;
  fileName: string;
  content: string;
};

export const markdownDocs: MarkdownDoc[] = [
  {
    id: "competitive-deep-dive",
    title: "Competitive Deep Dive",
    fileName: "COMPETITIVE_DEEP_DIVE.md",
    content: competitiveDeepDive,
  },
  {
    id: "financial-projections",
    title: "Financial Projections",
    fileName: "FINANCIAL_PROJECTIONS.md",
    content: financialProjections,
  },
  {
    id: "sales-package",
    title: "Sales Package",
    fileName: "SALES_PACKAGE.md",
    content: salesPackage,
  },
  {
    id: "pitch-deck-outline",
    title: "Pitch Deck Outline",
    fileName: "PITCH_DECK_OUTLINE.md",
    content: pitchDeckOutline,
  },
];

export function getMarkdownDocById(id: string): MarkdownDoc | null {
  return markdownDocs.find((doc) => doc.id === id) ?? null;
}
