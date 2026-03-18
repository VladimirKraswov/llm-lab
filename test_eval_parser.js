const { parseEvalTxt, parseModelScore, calculateMetrics } = require('./src/services/evaluations');

const testText = `
Вопрос: Что такое замыкание (closure) в JavaScript?
Ответ: Замыкание — это функция, которая сохраняет доступ к переменным своей внешней функции даже после того, после того как внешняя функция завершила выполнение.
Оценка: 10/10

Вопрос: Как работает event loop?
Ответ: Это механизм для асинхронности.
Оценка: 7/10
`;

const samples = parseEvalTxt(testText);
console.log('Parsed samples:', samples);
if (samples.length !== 2) throw new Error('Expected 2 samples');

const scores = [
  '{"score": 8, "feedback": "Good"}',
  'score: 9',
  'Оценка: 5/10',
  '7/10',
  'The result is 6 из 10'
];

scores.forEach(s => {
  console.log(`Parsing "${s}":`, parseModelScore(s));
});

const mockResults = [
  { referenceScore: 10, predictedScore: 8, parseError: false },
  { referenceScore: 7, predictedScore: 7, parseError: false },
  { referenceScore: 5, predictedScore: null, parseError: true },
];

const metrics = calculateMetrics(mockResults);
console.log('Metrics:', metrics);
