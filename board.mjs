function cellKey(row, column) {
  return `${row}:${column}`;
}

function normalizedCells(cells) {
  if (!Array.isArray(cells) || cells.length === 0) {
    throw new Error("A rendered slate must contain at least one cell.");
  }

  const seen = new Set();
  const normalized = cells.map((cell) => {
    if (
      !Array.isArray(cell) ||
      cell.length !== 2 ||
      !Number.isInteger(cell[0]) ||
      !Number.isInteger(cell[1])
    ) {
      throw new Error("Slate cells must be integer [row, column] pairs.");
    }
    const key = cellKey(cell[0], cell[1]);
    if (seen.has(key)) {
      throw new Error(`Duplicate slate cell ${key}.`);
    }
    seen.add(key);
    return cell;
  });

  return normalized.sort(
    ([leftRow, leftColumn], [rightRow, rightColumn]) =>
      leftRow - rightRow || leftColumn - rightColumn,
  );
}

export function buildPiecePaths(cells) {
  const normalized = normalizedCells(cells);
  const occupied = new Set(
    normalized.map(([row, column]) => cellKey(row, column)),
  );
  const fills = [];
  const boundaries = [];

  for (const [row, column] of normalized) {
    fills.push(`M ${column} ${row} h 1 v 1 h -1 Z`);
    if (!occupied.has(cellKey(row - 1, column))) {
      boundaries.push(`M ${column} ${row} H ${column + 1}`);
    }
    if (!occupied.has(cellKey(row, column + 1))) {
      boundaries.push(`M ${column + 1} ${row} V ${row + 1}`);
    }
    if (!occupied.has(cellKey(row + 1, column))) {
      boundaries.push(`M ${column + 1} ${row + 1} H ${column}`);
    }
    if (!occupied.has(cellKey(row, column - 1))) {
      boundaries.push(`M ${column} ${row + 1} V ${row}`);
    }
  }

  return {
    fillPath: fills.join(" "),
    boundaryPath: boundaries.join(" "),
  };
}
