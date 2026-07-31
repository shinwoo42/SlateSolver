import { queryCatalog, validateCatalog } from "./catalog.mjs";
import { buildPiecePaths } from "./board.mjs";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

const PIECE_COLORS = {
  Starlight: "#ffe599",
  Moth: "#f9cb9c",
  Corner: "#f5b16a",
  Pedigree: "#ff9900",
  Divinity: "#e06666",
  Prairie: "#ffadad",
  SpaceRift: "#f1c232",
  Banishment: "#3d85c6",
  Judgment: "#3d85c6",
};

const PIECE_CATEGORIES = [
  {
    name: "Crafted",
    pieces: ["Divinity"],
  },
  {
    name: "Legendary",
    pieces: [
      "Starlight",
      "Corner",
      "Moth",
      "Prairie",
      "SpaceRift",
      "Pedigree",
    ],
  },
  {
    name: "Nether King",
    pieces: ["Banishment", "Judgment"],
  },
];

const elements = {
  inventoryList: document.querySelector("#inventory-list"),
  inventoryTemplate: document.querySelector("#inventory-row-template"),
  resetLimits: document.querySelector("#reset-limits"),
  solutionStatus: document.querySelector("#solution-status"),
  score: document.querySelector("#metric-score"),
  resultGrid: document.querySelector(".result-grid"),
  boardPanel: document.querySelector(".board-panel"),
  board: document.querySelector("#solution-board"),
  boardEmptyState: document.querySelector("#board-empty-state"),
  boardHint: document.querySelector("#board-hint"),
  legend: document.querySelector("#solution-legend"),
};

const state = {
  catalog: null,
  pieceCounts: {},
  controls: new Map(),
};

loadCatalog();

async function loadCatalog() {
  try {
    const response = await fetch("./catalog.json", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Catalog request failed with status ${response.status}.`);
    }
    state.catalog = validateCatalog(await response.json());
    for (const pieceType of state.catalog.piece_types) {
      state.pieceCounts[pieceType.name] = {
        min: 0,
        max: pieceType.maximum,
      };
    }
    renderInventoryControls();
    bindGlobalActions();
    updateSolution();
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  }
}

function renderInventoryControls() {
  const fragment = document.createDocumentFragment();
  const pieceTypesByName = new Map(
    state.catalog.piece_types.map((pieceType) => [pieceType.name, pieceType]),
  );
  const categorizedNames = new Set(
    PIECE_CATEGORIES.flatMap((category) => category.pieces),
  );
  const categories = PIECE_CATEGORIES.map((category) => ({
    ...category,
    pieceTypes: category.pieces
      .map((name) => pieceTypesByName.get(name))
      .filter(Boolean),
  })).filter((category) => category.pieceTypes.length);
  const uncategorized = state.catalog.piece_types.filter(
    (pieceType) => !categorizedNames.has(pieceType.name),
  );
  if (uncategorized.length) {
    categories.push({
      name: "Other",
      pieceTypes: uncategorized,
    });
  }

  categories.forEach((category) => {
    const heading = document.createElement("h3");
    heading.className = "inventory-category";
    heading.textContent = category.name;
    fragment.append(heading);

    category.pieceTypes.forEach((pieceType) => {
      const index = state.catalog.piece_types.indexOf(pieceType);
      fragment.append(createInventoryRow(pieceType, index));
    });
  });
  elements.inventoryList.replaceChildren(fragment);
}

function createInventoryRow(pieceType, index) {
  const row = elements.inventoryTemplate.content.firstElementChild.cloneNode(true);
  const color = pieceColor(pieceType.name, index);
  row.style.setProperty("--piece-color", color);
  row.querySelector(".piece-name").textContent = pieceType.name;

  const minimumInput = row.querySelector(".minimum-input");
  const maximumInput = row.querySelector(".maximum-input");
  const minimumDecrease = row.querySelector(".minimum-decrease");
  const minimumIncrease = row.querySelector(".minimum-increase");
  const maximumDecrease = row.querySelector(".maximum-decrease");
  const maximumIncrease = row.querySelector(".maximum-increase");
  minimumInput.id = `minimum-${slug(pieceType.name)}`;
  maximumInput.id = `maximum-${slug(pieceType.name)}`;
  minimumInput.max = String(pieceType.maximum);
  maximumInput.max = String(pieceType.maximum);
  minimumInput.value = "0";
  maximumInput.value = String(pieceType.maximum);
  minimumInput.setAttribute(
    "aria-label",
    `${pieceType.name} minimum count`,
  );
  maximumInput.setAttribute(
    "aria-label",
    `${pieceType.name} maximum count`,
  );
  for (const [button, action, input] of [
    [minimumDecrease, "Decrease minimum", minimumInput],
    [minimumIncrease, "Increase minimum", minimumInput],
    [maximumDecrease, "Decrease maximum", maximumInput],
    [maximumIncrease, "Increase maximum", maximumInput],
  ]) {
    button.setAttribute("aria-label", `${action} for ${pieceType.name}`);
    button.setAttribute("aria-controls", input.id);
  }

  minimumInput.addEventListener("input", () => {
    const minimum = clampCount(minimumInput.value, pieceType.maximum);
    const maximum = Math.max(
      minimum,
      state.pieceCounts[pieceType.name].max,
    );
    setRange(pieceType.name, minimum, maximum, false);
    updateSolution();
  });
  maximumInput.addEventListener("input", () => {
    const maximum = clampCount(maximumInput.value, pieceType.maximum);
    const minimum = Math.min(
      state.pieceCounts[pieceType.name].min,
      maximum,
    );
    setRange(pieceType.name, minimum, maximum, false);
    updateSolution();
  });
  minimumDecrease.addEventListener("click", () => {
    changeBound(pieceType.name, "min", -1);
  });
  minimumIncrease.addEventListener("click", () => {
    changeBound(pieceType.name, "min", 1);
  });
  maximumDecrease.addEventListener("click", () => {
    changeBound(pieceType.name, "max", -1);
  });
  maximumIncrease.addEventListener("click", () => {
    changeBound(pieceType.name, "max", 1);
  });

  state.controls.set(pieceType.name, {
    minimumInput,
    maximumInput,
    minimumDecrease,
    minimumIncrease,
    maximumDecrease,
    maximumIncrease,
    row,
    maximum: pieceType.maximum,
  });
  setRange(pieceType.name, 0, pieceType.maximum, false);
  return row;
}

function bindGlobalActions() {
  elements.resetLimits.addEventListener("click", () => {
    for (const pieceType of state.catalog.piece_types) {
      setRange(pieceType.name, 0, pieceType.maximum, false);
    }
    updateSolution();
  });
}

function changeBound(name, bound, delta) {
  const current = state.pieceCounts[name];
  if (bound === "min") {
    const minimum = current.min + delta;
    setRange(name, minimum, Math.max(current.max, minimum));
    return;
  }
  const maximum = current.max + delta;
  setRange(name, Math.min(current.min, maximum), maximum);
}

function setRange(name, minimum, maximum, shouldUpdate = true) {
  const controls = state.controls.get(name);
  const normalizedMinimum = clampCount(minimum, controls.maximum);
  const normalizedMaximum = Math.max(
    normalizedMinimum,
    clampCount(maximum, controls.maximum),
  );
  state.pieceCounts[name] = {
    min: normalizedMinimum,
    max: normalizedMaximum,
  };
  controls.minimumInput.value = String(normalizedMinimum);
  controls.maximumInput.value = String(normalizedMaximum);
  controls.minimumDecrease.disabled = normalizedMinimum === 0;
  controls.minimumIncrease.disabled = normalizedMinimum === controls.maximum;
  controls.maximumDecrease.disabled = normalizedMaximum === 0;
  controls.maximumIncrease.disabled = normalizedMaximum === controls.maximum;
  controls.row.classList.toggle("excluded", normalizedMaximum === 0);
  if (shouldUpdate) {
    updateSolution();
  }
}

function updateSolution() {
  if (!state.catalog) {
    return;
  }
  try {
    const result = queryCatalog(state.catalog, state.pieceCounts);
    if (result.scenario === null) {
      showError(
        "No selectable solution satisfies these count limits.",
        "No solution for these limits.",
      );
      return;
    }
    renderScenario(result.scenario);
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  }
}

function renderScenario(scenario) {
  elements.solutionStatus.classList.remove("error");
  elements.resultGrid.classList.remove("no-solution");
  elements.boardPanel.classList.remove("no-solution");
  elements.boardEmptyState.hidden = true;
  elements.board.setAttribute("aria-label", "Solution board");
  const status = state.catalog.statuses[scenario.status];
  elements.solutionStatus.querySelector(".solution-status-label").textContent =
    scenario.status === "OPTIMAL" ? "Optimal" : status.message;
  elements.score.textContent = formatScore(scenario.objective_value);
  elements.boardHint.textContent =
    scenario.key === "empty" ? "Empty inventory" : "";
  renderBoard(scenario);
  renderLegend(scenario);
}

function renderBoard(scenario) {
  const pattern = state.catalog.board_pattern;
  const width = pattern[0].length;
  const height = pattern.length;
  const memberToCanonical = new Map();
  const typeByName = new Map();
  state.catalog.piece_types.forEach((pieceType, index) => {
    typeByName.set(pieceType.name, { ...pieceType, index });
    for (const member of pieceType.members) {
      memberToCanonical.set(member, pieceType.name);
    }
  });

  const fragment = document.createDocumentFragment();
  const baseLayer = svgElement("g", "board-base");
  baseLayer.setAttribute("aria-hidden", "true");
  pattern.forEach((patternRow, row) => {
    [...patternRow].forEach((marker, column) => {
      if (marker === "#") {
        const cell = svgElement("rect", "board-base-cell");
        cell.setAttribute("x", String(column));
        cell.setAttribute("y", String(row));
        cell.setAttribute("width", "1");
        cell.setAttribute("height", "1");
        baseLayer.append(cell);
      }
    });
  });
  fragment.append(baseLayer);

  const pieceLayer = svgElement("g", "board-pieces");
  scenario.placements.forEach((placement) => {
    const canonical = memberToCanonical.get(placement.piece) ?? placement.piece;
    const type = typeByName.get(canonical);
    const color = pieceColor(canonical, type?.index ?? 0);
    const geometry = buildPiecePaths(placement.cells);
    const group = svgElement("g", "board-piece");
    group.style.setProperty("--piece-color", color);

    const title = svgElement("title");
    title.textContent =
      canonical === placement.piece
        ? canonical
        : `${canonical} · ${placement.piece}`;
    const fill = svgElement("path", "board-piece-fill");
    fill.setAttribute("d", geometry.fillPath);
    const outline = svgElement("path", "board-piece-outline");
    outline.setAttribute("d", geometry.boundaryPath);
    outline.setAttribute("aria-hidden", "true");
    group.append(title, fill, outline);
    pieceLayer.append(group);
  });
  fragment.append(pieceLayer);

  elements.board.setAttribute("viewBox", `0 0 ${width} ${height}`);
  elements.board.setAttribute("preserveAspectRatio", "xMidYMid meet");
  elements.board.replaceChildren(fragment);
}

function svgElement(name, className = "") {
  const element = document.createElementNS(SVG_NAMESPACE, name);
  if (className) {
    element.setAttribute("class", className);
  }
  return element;
}

function renderLegend(scenario) {
  const scores = new Map(scenario.score_breakdown);
  const typeIndex = new Map(
    state.catalog.piece_types.map((pieceType, index) => [
      pieceType.name,
      index,
    ]),
  );
  const rows = [];
  for (const pieceType of state.catalog.piece_types) {
    const count = scenario.inventory[pieceType.name] ?? 0;
    if (!count) {
      continue;
    }
    const row = document.createElement("div");
    row.className = "legend-row";
    row.style.setProperty(
      "--piece-color",
      pieceColor(pieceType.name, typeIndex.get(pieceType.name)),
    );

    const swatch = document.createElement("span");
    swatch.className = "legend-swatch";
    const name = document.createElement("span");
    name.className = "legend-name";
    name.textContent = `${count}× ${pieceType.name}`;
    const score = document.createElement("span");
    score.className = "legend-score";
    score.textContent = formatScore(scores.get(pieceType.name) ?? 0);
    row.append(swatch, name, score);
    rows.push(row);
  }
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "legend-empty";
    empty.textContent = "No slates used.";
    rows.push(empty);
  }
  elements.legend.replaceChildren(...rows);
}

function showError(message, boardMessage = "Unable to display a solution.") {
  elements.solutionStatus.classList.add("error");
  elements.solutionStatus.querySelector(".solution-status-label").textContent =
    message;
  elements.score.textContent = "—";
  elements.boardHint.textContent = "";
  elements.legend.replaceChildren();
  elements.resultGrid.classList.add("no-solution");
  elements.boardPanel.classList.add("no-solution");
  elements.boardEmptyState.textContent = boardMessage;
  elements.boardEmptyState.hidden = false;
  elements.board.setAttribute("aria-label", boardMessage);
  if (state.catalog) {
    renderBoard({
      inventory: {},
      placements: [],
    });
  } else {
    elements.board.replaceChildren();
  }
}

function pieceColor(name, index = 0) {
  const fallback = [
    "#ffe599",
    "#f9cb9c",
    "#f5b16a",
    "#ff9900",
    "#e06666",
    "#3d85c6",
  ];
  return PIECE_COLORS[name] ?? fallback[index % fallback.length];
}

function clampCount(value, maximum) {
  const numeric = Number.parseInt(value, 10);
  return Number.isFinite(numeric)
    ? Math.max(0, Math.min(numeric, maximum))
    : 0;
}

function formatScore(value) {
  return Number(value).toLocaleString(undefined, {
    maximumFractionDigits: 1,
  });
}

function slug(value) {
  return value.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
}
