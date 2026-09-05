import { equalWeights, type Leg } from "./slate";

/**
 * Starter slates.
 *
 * They exist so the app is never an empty page: a first-time visitor with no
 * feed yet still has something concrete to price, buy and share. Weights are
 * equal by default — a starter should be a legible starting point to edit, not
 * an opinion presented as research.
 */
export type Template = {
  name: string;
  blurb: string;
  legs: Leg[];
};

export const TEMPLATES: Template[] = [
  {
    name: "The Magnificent Six",
    blurb: "The megacaps that carry the index.",
    legs: equalWeights(["AAPLc", "MSFTc", "GOOGLc", "AMZNc", "METAc", "NVDAc"]),
  },
  {
    name: "AI Buildout",
    blurb: "Silicon, models and the data centres in between.",
    legs: [
      { symbol: "NVDAc", bps: 3500 },
      { symbol: "MSFTc", bps: 2500 },
      { symbol: "GOOGLc", bps: 2000 },
      { symbol: "METAc", bps: 2000 },
    ],
  },
  {
    name: "Crypto Equities",
    blurb: "The listed side of the trade you are already in.",
    legs: [
      { symbol: "COINc", bps: 4000 },
      { symbol: "CRCLc", bps: 3000 },
      { symbol: "MSTRc", bps: 3000 },
    ],
  },
  {
    name: "Frontier",
    blurb: "Space, silicon and the long horizon.",
    legs: [
      { symbol: "SPCXc", bps: 4000 },
      { symbol: "TSLAc", bps: 3000 },
      { symbol: "NVDAc", bps: 3000 },
    ],
  },
];
