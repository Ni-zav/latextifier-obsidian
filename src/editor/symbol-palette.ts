import { App, FuzzySuggestModal } from "obsidian";

export interface LatexSymbol {
  name: string;
  latex: string;
  category: string;
}

const SYMBOLS: LatexSymbol[] = [
  { name: "alpha α", latex: "\\alpha", category: "Greek" },
  { name: "beta β", latex: "\\beta", category: "Greek" },
  { name: "gamma γ", latex: "\\gamma", category: "Greek" },
  { name: "delta δ", latex: "\\delta", category: "Greek" },
  { name: "epsilon ε", latex: "\\epsilon", category: "Greek" },
  { name: "theta θ", latex: "\\theta", category: "Greek" },
  { name: "lambda λ", latex: "\\lambda", category: "Greek" },
  { name: "mu μ", latex: "\\mu", category: "Greek" },
  { name: "pi π", latex: "\\pi", category: "Greek" },
  { name: "rho ρ", latex: "\\rho", category: "Greek" },
  { name: "sigma σ", latex: "\\sigma", category: "Greek" },
  { name: "phi φ", latex: "\\phi", category: "Greek" },
  { name: "omega ω", latex: "\\omega", category: "Greek" },
  { name: "Gamma Γ", latex: "\\Gamma", category: "Greek" },
  { name: "Delta Δ", latex: "\\Delta", category: "Greek" },
  { name: "Theta Θ", latex: "\\Theta", category: "Greek" },
  { name: "Lambda Λ", latex: "\\Lambda", category: "Greek" },
  { name: "Pi Π", latex: "\\Pi", category: "Greek" },
  { name: "Sigma Σ", latex: "\\Sigma", category: "Greek" },
  { name: "Phi Φ", latex: "\\Phi", category: "Greek" },
  { name: "Omega Ω", latex: "\\Omega", category: "Greek" },
  { name: "sum ∑", latex: "\\sum", category: "Operators" },
  { name: "product ∏", latex: "\\prod", category: "Operators" },
  { name: "integral ∫", latex: "\\int", category: "Operators" },
  { name: "double integral ∬", latex: "\\iint", category: "Operators" },
  { name: "partial ∂", latex: "\\partial", category: "Operators" },
  { name: "nabla ∇", latex: "\\nabla", category: "Operators" },
  { name: "infinity ∞", latex: "\\infty", category: "Operators" },
  { name: "sqrt √", latex: "\\sqrt{}", category: "Operators" },
  { name: "fraction", latex: "\\frac{}{}", category: "Operators" },
  { name: "approximately ≈", latex: "\\approx", category: "Relations" },
  { name: "not equal ≠", latex: "\\neq", category: "Relations" },
  { name: "less or equal ≤", latex: "\\leq", category: "Relations" },
  { name: "greater or equal ≥", latex: "\\geq", category: "Relations" },
  { name: "equivalent ≡", latex: "\\equiv", category: "Relations" },
  { name: "proportional ∝", latex: "\\propto", category: "Relations" },
  { name: "element of ∈", latex: "\\in", category: "Sets" },
  { name: "not element of ∉", latex: "\\notin", category: "Sets" },
  { name: "subset ⊂", latex: "\\subset", category: "Sets" },
  { name: "subset or equal ⊆", latex: "\\subseteq", category: "Sets" },
  { name: "union ∪", latex: "\\cup", category: "Sets" },
  { name: "intersection ∩", latex: "\\cap", category: "Sets" },
  { name: "empty set ∅", latex: "\\emptyset", category: "Sets" },
  { name: "forall ∀", latex: "\\forall", category: "Logic" },
  { name: "exists ∃", latex: "\\exists", category: "Logic" },
  { name: "land ∧", latex: "\\land", category: "Logic" },
  { name: "lor ∨", latex: "\\lor", category: "Logic" },
  { name: "negation ¬", latex: "\\neg", category: "Logic" },
  { name: "right arrow →", latex: "\\rightarrow", category: "Arrows" },
  { name: "left arrow ←", latex: "\\leftarrow", category: "Arrows" },
  { name: "leftright arrow ↔", latex: "\\leftrightarrow", category: "Arrows" },
  { name: "Rightarrow ⇒", latex: "\\Rightarrow", category: "Arrows" },
  { name: "Leftarrow ⇐", latex: "\\Leftarrow", category: "Arrows" },
  { name: "Leftrightarrow ⇔", latex: "\\Leftrightarrow", category: "Arrows" },
  { name: "mapsto ↦", latex: "\\mapsto", category: "Arrows" },
  { name: "times ×", latex: "\\times", category: "Misc" },
  { name: "cdot ·", latex: "\\cdot", category: "Misc" },
  { name: "degree °", latex: "^{\\circ}", category: "Misc" },
  { name: "ellipsis …", latex: "\\ldots", category: "Misc" },
  { name: "centered ellipsis ⋯", latex: "\\cdots", category: "Misc" }
];

export class SymbolPaletteModal extends FuzzySuggestModal<LatexSymbol> {
  constructor(
    app: App,
    private readonly insert: (latex: string) => void
  ) {
    super(app);
    this.setPlaceholder("Search LaTeX symbols…");
  }

  getItems(): LatexSymbol[] {
    return SYMBOLS;
  }

  getItemText(item: LatexSymbol): string {
    return item.name + " · " + item.category + " · " + item.latex;
  }

  onChooseItem(item: LatexSymbol): void {
    this.insert(item.latex);
  }
}
