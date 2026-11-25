// База данных SQLite и функции для работы с ней (как в ЛР №7, модуль node:sqlite)
const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync(__dirname + '/equipment.db');

// Статусы оборудования (чтобы не писать строки вручную по всему коду)
const STATUS = {
  AVAILABLE: 'available', // свободно
  IN_USE: 'in_use', // в использовании (выдано)
};

// Включаем внешние ключи (в SQLite они по умолчанию выключены)
db.exec('PRAGMA foreign_keys = ON');

// Создание таблиц
db.exec(`
  CREATE TABLE IF NOT EXISTS equipment (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    type          TEXT NOT NULL,
    serial_number TEXT NOT NULL UNIQUE,
    status        TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'in_use'))
  );

  CREATE TABLE IF NOT EXISTS loans (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    equipment_id INTEGER NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
    borrower     TEXT NOT NULL,
    issue_date   TEXT NOT NULL,
    return_date  TEXT
  );

  -- Защита от двойной выдачи на уровне БД:
  -- у одного оборудования может быть только одна незакрытая выдача (return_date IS NULL)
  CREATE UNIQUE INDEX IF NOT EXISTS one_active_loan
    ON loans(equipment_id) WHERE return_date IS NULL;
`);

// Начальные данные для демонстрации (только если таблица пустая)
if (db.prepare('SELECT COUNT(*) AS n FROM equipment').get().n === 0) {
  const insert = db.prepare('INSERT INTO equipment (name, type, serial_number) VALUES (?, ?, ?)');
  insert.run('Осциллограф Rigol DS1054Z', 'Измерительное', 'OSC-001');
  insert.run('Мультиметр UNI-T UT61E', 'Измерительное', 'MM-014');
  insert.run('Паяльная станция Lukey 702', 'Инструмент', 'SOL-007');
  insert.run('Ноутбук Lenovo ThinkPad', 'Компьютер', 'NB-112');
}

// ---------- Оборудование ----------

// Оборудование + данные активной выдачи (если есть).
// LEFT JOIN: оборудование показывается всегда, а поля выдачи заполняются,
// только если есть выдача без даты возврата.
const SELECT_EQUIPMENT = `
  SELECT e.id, e.name, e.type, e.serial_number, e.status,
         l.id AS loan_id, l.borrower, l.issue_date
  FROM equipment e
  LEFT JOIN loans l ON l.equipment_id = e.id AND l.return_date IS NULL
`;

// Список с необязательными фильтрами по типу и статусу
function getEquipment({ type, status } = {}) {
  const conditions = [];
  const params = [];
  if (type) {
    conditions.push('e.type = ?');
    params.push(type);
  }
  if (status) {
    conditions.push('e.status = ?');
    params.push(status);
  }
  const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
  return db.prepare(SELECT_EQUIPMENT + where + ' ORDER BY e.name').all(...params);
}

function getEquipmentById(id) {
  return db.prepare(SELECT_EQUIPMENT + ' WHERE e.id = ?').get(id);
}

// Список всех типов (для фильтра)
function getTypes() {
  return db
    .prepare('SELECT DISTINCT type FROM equipment ORDER BY type')
    .all()
    .map((row) => row.type);
}

function createEquipment({ name, type, serial_number }) {
  const result = db
    .prepare('INSERT INTO equipment (name, type, serial_number) VALUES (?, ?, ?)')
    .run(name, type, serial_number);
  return getEquipmentById(result.lastInsertRowid);
}

// Статус здесь не меняется — он меняется только при выдаче/возврате
function updateEquipment(id, { name, type, serial_number }) {
  const result = db
    .prepare('UPDATE equipment SET name = ?, type = ?, serial_number = ? WHERE id = ?')
    .run(name, type, serial_number, id);
  return result.changes > 0 ? getEquipmentById(id) : null;
}

// История выдач удаляется автоматически (ON DELETE CASCADE)
function deleteEquipment(id) {
  return db.prepare('DELETE FROM equipment WHERE id = ?').run(id).changes > 0;
}

// ---------- Выдачи ----------

// Активные выдачи (ещё не возвращены) вместе с названием оборудования
function getActiveLoans() {
  return db
    .prepare(
      `SELECT l.id, l.equipment_id, l.borrower, l.issue_date,
              e.name, e.serial_number
       FROM loans l
       JOIN equipment e ON e.id = l.equipment_id
       WHERE l.return_date IS NULL
       ORDER BY l.issue_date DESC, l.id DESC`
    )
    .all();
}

function getLoanById(id) {
  return db.prepare('SELECT * FROM loans WHERE id = ?').get(id);
}

// Выполнить функцию в транзакции: либо все изменения, либо ни одного
function inTransaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec(result ? 'COMMIT' : 'ROLLBACK');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Выдача. Возвращает созданную выдачу или null, если оборудование уже выдано.
function issueEquipment(equipmentId, borrower, issueDate) {
  return inTransaction(() => {
    // Меняем статус, только если оборудование сейчас свободно.
    // Если changes = 0 — оно уже выдано, выдачу не создаём.
    const updated = db
      .prepare('UPDATE equipment SET status = ? WHERE id = ? AND status = ?')
      .run(STATUS.IN_USE, equipmentId, STATUS.AVAILABLE);
    if (updated.changes === 0) return null;

    const result = db
      .prepare('INSERT INTO loans (equipment_id, borrower, issue_date) VALUES (?, ?, ?)')
      .run(equipmentId, borrower, issueDate);
    return getLoanById(result.lastInsertRowid);
  });
}

// Возврат. Возвращает закрытую выдачу или null, если она уже была закрыта.
function returnEquipment(loanId) {
  return inTransaction(() => {
    // Ставим дату возврата только незакрытой выдаче
    const updated = db
      .prepare("UPDATE loans SET return_date = DATE('now', 'localtime') WHERE id = ? AND return_date IS NULL")
      .run(loanId);
    if (updated.changes === 0) return null;

    // Оборудование этой выдачи снова свободно
    db.prepare('UPDATE equipment SET status = ? WHERE id = (SELECT equipment_id FROM loans WHERE id = ?)')
      .run(STATUS.AVAILABLE, loanId);
    return getLoanById(loanId);
  });
}

module.exports = {
  STATUS,
  getEquipment,
  getEquipmentById,
  getTypes,
  createEquipment,
  updateEquipment,
  deleteEquipment,
  getActiveLoans,
  getLoanById,
  issueEquipment,
  returnEquipment,
};
