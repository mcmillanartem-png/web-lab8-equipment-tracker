// Лабораторная работа №8. Вариант 20 — «Система учёта оборудования»
// Основа — сервер из ЛР №6 (страницы, статика, PWA) и модуль БД из ЛР №7
const express = require('express');
const db = require('./db');

const app = express();
const PORT = 3002;

app.use(express.json());

// Логирование каждого запроса в консоль
app.use((req, res, next) => {
  console.log(req.method, req.url);
  next();
});

app.use(express.static(__dirname + '/public'));

// ---------- Страницы ----------
app.get('/', (req, res) => res.sendFile(__dirname + '/public/index.html'));
app.get('/about', (req, res) => res.sendFile(__dirname + '/public/about.html'));

// ---------- Проверка входных данных ----------

// Проверка полей оборудования. Возвращает текст ошибки или null.
function validateEquipment(body) {
  const { name, type, serial_number } = body || {};
  if (!name || !String(name).trim()) return 'Укажите название';
  if (!type || !String(type).trim()) return 'Укажите тип';
  if (!serial_number || !String(serial_number).trim()) return 'Укажите серийный номер';
  return null;
}

function cleanEquipment(body) {
  return {
    name: String(body.name).trim(),
    type: String(body.type).trim(),
    serial_number: String(body.serial_number).trim(),
  };
}

// Дата в формате ГГГГ-ММ-ДД
function isValidDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

function today() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

const isUniqueError = (err) => String(err.message).includes('UNIQUE');

// ---------- API: оборудование ----------

// GET /api/equipment?type=Компьютер&status=available
app.get('/api/equipment', (req, res) => {
  const { type, status } = req.query;
  if (status && !Object.values(db.STATUS).includes(status)) {
    return res.status(400).json({ error: 'Неизвестный статус' });
  }
  res.json(db.getEquipment({ type, status }));
});

// GET /api/equipment/types — список типов для фильтра
app.get('/api/equipment/types', (req, res) => {
  res.json(db.getTypes());
});

app.get('/api/equipment/:id', (req, res) => {
  const item = db.getEquipmentById(req.params.id);
  if (!item) return res.status(404).json({ error: 'Оборудование не найдено' });
  res.json(item);
});

app.post('/api/equipment', (req, res) => {
  const error = validateEquipment(req.body);
  if (error) return res.status(400).json({ error });
  try {
    res.status(201).json(db.createEquipment(cleanEquipment(req.body)));
  } catch (err) {
    if (isUniqueError(err)) {
      return res.status(409).json({ error: 'Оборудование с таким серийным номером уже есть' });
    }
    throw err;
  }
});

app.put('/api/equipment/:id', (req, res) => {
  const error = validateEquipment(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const item = db.updateEquipment(req.params.id, cleanEquipment(req.body));
    if (!item) return res.status(404).json({ error: 'Оборудование не найдено' });
    res.json(item);
  } catch (err) {
    if (isUniqueError(err)) {
      return res.status(409).json({ error: 'Оборудование с таким серийным номером уже есть' });
    }
    throw err;
  }
});

app.delete('/api/equipment/:id', (req, res) => {
  const item = db.getEquipmentById(req.params.id);
  if (!item) return res.status(404).json({ error: 'Оборудование не найдено' });
  if (item.status === db.STATUS.IN_USE) {
    return res.status(409).json({ error: 'Нельзя удалить выданное оборудование — сначала оформите возврат' });
  }
  db.deleteEquipment(req.params.id);
  res.json({ message: 'Оборудование удалено', id: Number(req.params.id) });
});

// ---------- API: выдачи ----------

// GET /api/loans — активные выдачи
app.get('/api/loans', (req, res) => {
  res.json(db.getActiveLoans());
});

// POST /api/loans — выдача. Тело: { equipment_id, borrower, issue_date? }
app.post('/api/loans', (req, res) => {
  const { equipment_id, borrower } = req.body || {};
  const issueDate = req.body?.issue_date || today();

  if (!borrower || !String(borrower).trim()) {
    return res.status(400).json({ error: 'Укажите, кому выдаётся оборудование' });
  }
  if (!isValidDate(issueDate)) {
    return res.status(400).json({ error: 'Дата выдачи должна быть в формате ГГГГ-ММ-ДД' });
  }

  const item = db.getEquipmentById(equipment_id);
  if (!item) return res.status(404).json({ error: 'Оборудование не найдено' });

  // Проверка, что оборудование не выдано дважды
  const loan = db.issueEquipment(item.id, String(borrower).trim(), issueDate);
  if (!loan) {
    return res.status(409).json({ error: 'Оборудование уже выдано' });
  }
  res.status(201).json(loan);
});

// POST /api/loans/:id/return — возврат
app.post('/api/loans/:id/return', (req, res) => {
  if (!db.getLoanById(req.params.id)) {
    return res.status(404).json({ error: 'Выдача не найдена' });
  }
  const loan = db.returnEquipment(req.params.id);
  if (!loan) return res.status(409).json({ error: 'Оборудование уже возвращено' });
  res.json(loan);
});

// ---------- Ошибки ----------

// Неизвестный адрес API → 404
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Не найдено' });
});

// Любая непредвиденная ошибка → 500
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
  console.log(`Открой в браузере: http://localhost:${PORT}`);
});
