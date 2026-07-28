export const CATALOG_FORMAT_VERSION = 1;

export function validateCatalog(catalog) {
  if (!catalog || typeof catalog !== "object") {
    throw new Error("Catalog root must be an object.");
  }
  if (catalog.format_version !== CATALOG_FORMAT_VERSION) {
    throw new Error(
      `Unsupported catalog format version: ${catalog.format_version}.`,
    );
  }
  for (const field of [
    "board_pattern",
    "piece_types",
    "statuses",
    "scenarios",
  ]) {
    if (!(field in catalog)) {
      throw new Error(`Catalog is missing required field: ${field}.`);
    }
  }
  const names = new Set();
  for (const pieceType of catalog.piece_types) {
    if (!pieceType.name || names.has(pieceType.name)) {
      throw new Error("Canonical piece names must be unique.");
    }
    names.add(pieceType.name);
  }
  for (const scenario of catalog.scenarios) {
    const definition = catalog.statuses[scenario.status];
    if (!definition) {
      throw new Error(
        `Scenario ${scenario.key} has unknown status ${scenario.status}.`,
      );
    }
    if (definition.selectable && !("objective_value" in scenario)) {
      throw new Error(
        `Selectable scenario ${scenario.key} has no objective value.`,
      );
    }
  }
  return catalog;
}

export function queryCatalog(catalog, pieceCounts = {}) {
  const pieceTypes = new Map(
    catalog.piece_types.map((pieceType) => [pieceType.name, pieceType]),
  );
  const knownNames = new Set(pieceTypes.keys());
  for (const name of Object.keys(pieceCounts)) {
    if (!knownNames.has(name)) {
      throw new Error(`Unknown canonical piece type: ${name}.`);
    }
  }

  const limits = new Map();
  for (const [name, pieceType] of pieceTypes) {
    limits.set(name, normalizeRange(name, pieceCounts[name], pieceType.maximum));
  }

  let bestScenario = null;
  let compatibleScenarios = 0;
  let infeasibleScenarios = 0;
  for (const scenario of catalog.scenarios) {
    const fits = [...limits].every(([name, range]) => {
      const count = scenario.inventory[name] ?? 0;
      return range.min <= count && count <= range.max;
    });
    if (!fits) {
      continue;
    }
    compatibleScenarios += 1;
    const status = catalog.statuses[scenario.status];
    if (status.category === "infeasible") {
      infeasibleScenarios += 1;
    }
    if (!status.selectable) {
      continue;
    }
    if (
      bestScenario === null ||
      compareSolutions(scenario, bestScenario) < 0
    ) {
      bestScenario = scenario;
    }
  }
  return {
    scenario: bestScenario,
    compatibleScenarios,
    infeasibleScenarios,
  };
}

function normalizeRange(name, specification, catalogMaximum) {
  if (specification === undefined) {
    return { min: 0, max: catalogMaximum };
  }
  if (
    !specification ||
    typeof specification !== "object" ||
    Array.isArray(specification)
  ) {
    throw new Error(`Piece-count specification for ${name} must be an object.`);
  }
  const unknownFields = Object.keys(specification).filter(
    (field) => field !== "min" && field !== "max",
  );
  if (unknownFields.length) {
    throw new Error(
      `Unknown piece-count field(s) for ${name}: ${unknownFields.join(", ")}.`,
    );
  }
  const minimum = Object.hasOwn(specification, "min")
    ? specification.min
    : 0;
  const hasExplicitMaximum =
    Object.hasOwn(specification, "max") && specification.max !== null;
  const requestedMaximum = specification.max ?? catalogMaximum;
  if (!Number.isInteger(minimum) || minimum < 0) {
    throw new Error(
      `Piece-count minimum for ${name} must be a non-negative integer.`,
    );
  }
  if (!Number.isInteger(requestedMaximum) || requestedMaximum < 0) {
    throw new Error(
      `Piece-count maximum for ${name} must be a non-negative integer.`,
    );
  }
  if (hasExplicitMaximum && minimum > requestedMaximum) {
    throw new Error(
      `Piece-count minimum for ${name} must not exceed its maximum.`,
    );
  }
  if (minimum > catalogMaximum) {
    throw new Error(
      `Piece-count minimum for ${name} exceeds the catalog maximum ` +
        `of ${catalogMaximum}.`,
    );
  }
  return {
    min: minimum,
    max: Math.min(requestedMaximum, catalogMaximum),
  };
}

function compareSolutions(left, right) {
  if (left.objective_value !== right.objective_value) {
    return right.objective_value - left.objective_value;
  }
  const leftCount = Object.values(left.inventory).reduce(
    (total, count) => total + count,
    0,
  );
  const rightCount = Object.values(right.inventory).reduce(
    (total, count) => total + count,
    0,
  );
  if (leftCount !== rightCount) {
    return leftCount - rightCount;
  }
  return left.key.localeCompare(right.key);
}
