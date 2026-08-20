export const CATALOG_FORMAT_VERSION = 2;

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
    const parameterNames = new Set();
    for (const parameter of pieceType.parameters ?? []) {
      if (!parameter.name || parameterNames.has(parameter.name)) {
        throw new Error(
          `Parameter names for ${pieceType.name} must be unique.`,
        );
      }
      parameterNames.add(parameter.name);
      const optionValues = new Set(
        (parameter.options ?? []).map((option) => option.value),
      );
      if (!optionValues.size || !optionValues.has(parameter.default)) {
        throw new Error(
          `Parameter ${pieceType.name}.${parameter.name} has invalid options or default.`,
        );
      }
    }
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
    if (!scenario.parameters || typeof scenario.parameters !== "object") {
      throw new Error(`Scenario ${scenario.key} has no parameter object.`);
    }
    const expectedParameterPieces = new Set(
      catalog.piece_types
        .filter(
          (pieceType) =>
            (scenario.inventory[pieceType.name] ?? 0) > 0 &&
            (pieceType.parameters ?? []).length > 0,
        )
        .map((pieceType) => pieceType.name),
    );
    if (
      Object.keys(scenario.parameters).length !== expectedParameterPieces.size ||
      Object.keys(scenario.parameters).some(
        (pieceName) => !expectedParameterPieces.has(pieceName),
      )
    ) {
      throw new Error(
        `Scenario ${scenario.key} does not contain exactly the parameters for its active pieces.`,
      );
    }
    for (const [pieceName, values] of Object.entries(scenario.parameters)) {
      const pieceType = catalog.piece_types.find(
        (candidate) => candidate.name === pieceName,
      );
      if (!pieceType || !values || typeof values !== "object") {
        throw new Error(
          `Scenario ${scenario.key} has invalid parameters for ${pieceName}.`,
        );
      }
      const definitions = new Map(
        (pieceType.parameters ?? []).map((parameter) => [
          parameter.name,
          parameter,
        ]),
      );
      if (
        Object.keys(values).length !== definitions.size ||
        Object.keys(values).some(
          (parameterName) => !definitions.has(parameterName),
        )
      ) {
        throw new Error(
          `Scenario ${scenario.key} does not contain exactly the parameters for ${pieceName}.`,
        );
      }
      for (const [parameterName, value] of Object.entries(values)) {
        const parameter = definitions.get(parameterName);
        if (
          !parameter ||
          !parameter.options.some((option) => option.value === value)
        ) {
          throw new Error(
            `Scenario ${scenario.key} has an invalid value for ${pieceName}.${parameterName}.`,
          );
        }
      }
    }
  }
  return catalog;
}

export function queryCatalog(
  catalog,
  pieceCounts = {},
  pieceParameters = {},
) {
  if (!pieceCounts || typeof pieceCounts !== "object" || Array.isArray(pieceCounts)) {
    throw new Error("Piece counts must be an object.");
  }
  if (
    !pieceParameters ||
    typeof pieceParameters !== "object" ||
    Array.isArray(pieceParameters)
  ) {
    throw new Error("Piece parameters must be an object.");
  }
  const pieceTypes = new Map(
    catalog.piece_types.map((pieceType) => [pieceType.name, pieceType]),
  );
  const knownNames = new Set(pieceTypes.keys());
  for (const name of Object.keys(pieceCounts)) {
    if (!knownNames.has(name)) {
      throw new Error(`Unknown canonical piece type: ${name}.`);
    }
  }
  for (const name of Object.keys(pieceParameters)) {
    if (!knownNames.has(name)) {
      throw new Error(`Unknown canonical piece type: ${name}.`);
    }
  }

  const limits = new Map();
  for (const [name, pieceType] of pieceTypes) {
    limits.set(name, normalizeRange(name, pieceCounts[name], pieceType.maximum));
  }
  const selectedParameters = new Map();
  for (const [name, pieceType] of pieceTypes) {
    selectedParameters.set(
      name,
      normalizeParameters(name, pieceType.parameters ?? [], pieceParameters[name]),
    );
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
    const parametersFit = [...selectedParameters].every(([name, selected]) => {
      if ((scenario.inventory[name] ?? 0) === 0) {
        return true;
      }
      const scenarioValues = scenario.parameters[name] ?? {};
      return [...selected].every(
        ([parameterName, selectedValue]) =>
          scenarioValues[parameterName] === selectedValue,
      );
    });
    if (!parametersFit) {
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

function normalizeParameters(name, definitions, specification) {
  const configured = specification ?? {};
  if (
    !configured ||
    typeof configured !== "object" ||
    Array.isArray(configured)
  ) {
    throw new Error(`Piece parameters for ${name} must be an object.`);
  }
  const definitionsByName = new Map(
    definitions.map((definition) => [definition.name, definition]),
  );
  const unknown = Object.keys(configured).filter(
    (parameterName) => !definitionsByName.has(parameterName),
  );
  if (unknown.length) {
    throw new Error(
      `Unknown piece parameter(s) for ${name}: ${unknown.join(", ")}.`,
    );
  }
  const selected = new Map();
  for (const definition of definitions) {
    const value = configured[definition.name] ?? definition.default;
    if (!definition.options.some((option) => option.value === value)) {
      throw new Error(
        `Invalid value ${value} for piece parameter ${name}.${definition.name}.`,
      );
    }
    selected.set(definition.name, value);
  }
  return selected;
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
