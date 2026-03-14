import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, type Dataset, type DatasetValidationResponse } from '../../lib/api';

function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
        props.disabled
          ? 'cursor-not-allowed bg-slate-800 text-slate-500'
          : 'bg-blue-600 text-white hover:bg-blue-500'
      } ${props.className || ''}`}
    />
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-500 ${props.className || ''}`}
    />
  );
}

function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`min-h-[220px] w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-500 ${props.className || ''}`}
    />
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 shadow-sm">
      <div className="mb-4 text-sm font-semibold text-white">{title}</div>
      {children}
    </div>
  );
}

function fmtDate(value?: string | null) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

type ManualItem = {
  user: string;
  assistant: string;
};

const CHAT_TEMPLATE = `{"messages":[{"role":"user","content":"Привет"},{"role":"assistant","content":"Привет! Чем помочь?"}]}
{"messages":[{"role":"user","content":"2+2?"},{"role":"assistant","content":"2+2 = 4."}]}
`;

const INSTRUCTION_TEMPLATE = `{"instruction":"Скажи привет","input":"","output":"Привет!"}
{"instruction":"Ответь сколько будет 2+2","input":"","output":"2+2 = 4."}
`;

const PROMPT_TEMPLATE = `{"prompt":"Переведи на английский: Привет","completion":"Hello"}
{"prompt":"Сделай краткое резюме: LLM are useful","completion":"LLMs are useful."}
`;

export default function DatasetsPage() {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [tab, setTab] = useState<'upload' | 'jsonl' | 'manual'>('upload');
  const [name, setName] = useState('');
  const [jsonl, setJsonl] = useState('');
  const [validation, setValidation] = useState<DatasetValidationResponse | null>(null);
  const [previewDatasetId, setPreviewDatasetId] = useState<string | null>(null);
  const [manualItems, setManualItems] = useState<ManualItem[]>([
    { user: 'Скажи привет', assistant: 'Привет!' },
    { user: '2+2?', assistant: '2+2 = 4.' },
  ]);

  function handleSelectedFile(file?: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      setJsonl(text);
      if (!name.trim()) {
        setName(file.name.replace(/\.jsonl$/i, ''));
      }
      setTab('jsonl');
    };
    reader.readAsText(file, 'utf-8');
  }

  function onDropFile(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0];
    handleSelectedFile(file);
  }

  const datasetsQuery = useQuery({
    queryKey: ['datasets'],
    queryFn: api.getDatasets,
  });

  const previewQuery = useQuery({
    queryKey: ['dataset-preview', previewDatasetId],
    queryFn: () => api.getDatasetPreview(previewDatasetId as string, 10),
    enabled: Boolean(previewDatasetId),
  });

  const validateJsonlMutation = useMutation({
    mutationFn: api.validateDatasetJsonl,
    onSuccess: setValidation,
  });

  const createJsonlMutation = useMutation({
    mutationFn: api.createDatasetFromJsonl,
    onSuccess: async () => {
      setJsonl('');
      setValidation(null);
      setName('');
      await qc.invalidateQueries({ queryKey: ['datasets'] });
    },
  });

  const createItemsMutation = useMutation({
    mutationFn: api.createDatasetFromItems,
    onSuccess: async () => {
      setName('');
      await qc.invalidateQueries({ queryKey: ['datasets'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteDataset,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['datasets'] });
      setPreviewDatasetId(null);
    },
  });

  const sorted = useMemo(
    () =>
      [...(datasetsQuery.data || [])].sort((a: Dataset, b: Dataset) =>
        String(b.createdAt).localeCompare(String(a.createdAt)),
      ),
    [datasetsQuery.data],
  );

  function createFromManual() {
    const items = manualItems
      .filter((x) => x.user.trim() && x.assistant.trim())
      .map((x) => ({
        messages: [
          { role: 'user', content: x.user.trim() },
          { role: 'assistant', content: x.assistant.trim() },
        ],
      }));

    createItemsMutation.mutate({
      name: name || `manual-dataset-${Date.now()}`,
      items,
    });
  }

  function applyTemplate(kind: 'chat' | 'instruction' | 'prompt') {
    setTab('jsonl');
    setValidation(null);
    if (kind === 'chat') setJsonl(CHAT_TEMPLATE);
    if (kind === 'instruction') setJsonl(INSTRUCTION_TEMPLATE);
    if (kind === 'prompt') setJsonl(PROMPT_TEMPLATE);
  }

  const rowsCount = jsonl.split('\n').map((x) => x.trim()).filter(Boolean).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Datasets</h1>
        <p className="mt-1 text-sm text-slate-400">
          Создавай датасеты из файла, из JSONL текста или вручную. Сначала проверь формат через Validate, потом сохраняй в базу.
        </p>
      </div>

      <Card title="Templates and tips">
        <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
          <div className="space-y-3">
            <div className="text-sm text-slate-300">Быстрые шаблоны</div>
            <div className="flex flex-wrap gap-2">
              <Button className="bg-slate-800 hover:bg-slate-700" onClick={() => applyTemplate('chat')}>
                Chat messages
              </Button>
              <Button className="bg-slate-800 hover:bg-slate-700" onClick={() => applyTemplate('instruction')}>
                Instruction / output
              </Button>
              <Button className="bg-slate-800 hover:bg-slate-700" onClick={() => applyTemplate('prompt')}>
                Prompt / completion
              </Button>
            </div>
          </div>

          <div className="rounded-xl bg-slate-950/50 p-4 text-sm text-slate-400">
            <div className="font-medium text-white">Подсказки</div>
            <ul className="mt-2 space-y-1">
              <li>• Для small smoke test хватит 2–20 строк.</li>
              <li>• Лучше использовать диалоговый формат messages.</li>
              <li>• У каждой строки должен быть осмысленный assistant output.</li>
              <li>• После создания dataset можно сразу перейти в Training.</li>
            </ul>
          </div>
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Card title="Create dataset">
          <div className="mb-4 flex gap-2">
            {(['upload', 'jsonl', 'manual'] as const).map((item) => (
              <button
                key={item}
                onClick={() => setTab(item)}
                className={`rounded-xl px-3 py-2 text-sm ${
                  tab === item ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300'
                }`}
              >
                {item === 'upload' ? 'Upload file' : item === 'jsonl' ? 'Paste JSONL' : 'Manual editor'}
              </button>
            ))}
          </div>

          <div className="mb-4">
            <label className="mb-2 block text-xs uppercase tracking-wide text-slate-500">Dataset name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-dataset" />
          </div>

          {tab === 'upload' && (
            <div className="space-y-4">
              <input
                ref={fileInputRef}
                type="file"
                accept=".jsonl,.txt,application/json"
                className="hidden"
                onChange={(e) => handleSelectedFile(e.target.files?.[0] || null)}
              />

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onDrop={onDropFile}
                className="flex min-h-[180px] items-center justify-center rounded-2xl border border-dashed border-slate-700 bg-slate-950/50 p-6 text-center text-slate-400"
              >
                <div>
                  <div className="text-sm text-white">Перетащи JSONL файл сюда</div>
                  <div className="mt-2 text-xs text-slate-500">
                    Поддерживаются chat-jsonl, instruction/output и prompt/completion
                  </div>
                  <div className="mt-4">
                    <Button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="bg-slate-800 hover:bg-slate-700"
                    >
                      Choose file
                    </Button>
                  </div>
                </div>
              </div>

              {!!jsonl.trim() && (
                <div className="rounded-xl bg-slate-950/50 p-3 text-xs text-slate-300">
                  Файл прочитан. Переключено в <span className="text-white">Paste JSONL</span>. Строк: {rowsCount}
                </div>
              )}
            </div>
          )}

          {tab === 'jsonl' && (
            <div className="space-y-4">
              <Textarea
                value={jsonl}
                onChange={(e) => setJsonl(e.target.value)}
                placeholder='{"messages":[{"role":"user","content":"Привет"},{"role":"assistant","content":"Привет!"}]}'
              />

              <div className="rounded-xl bg-slate-950/50 p-3 text-sm text-slate-400">
                Текущий объём: <span className="text-white">{rowsCount}</span> строк. Сначала нажми <span className="text-white">Validate</span>, чтобы увидеть распознанный формат и ошибки.
              </div>

              <div className="flex flex-wrap gap-3">
                <Button
                  onClick={() => validateJsonlMutation.mutate({ jsonl })}
                  disabled={!jsonl.trim() || validateJsonlMutation.isPending}
                >
                  Validate
                </Button>
                <Button
                  onClick={() =>
                    createJsonlMutation.mutate({
                      name: name || `dataset-${Date.now()}`,
                      jsonl,
                    })
                  }
                  disabled={!name.trim() || !jsonl.trim() || createJsonlMutation.isPending}
                >
                  Create dataset
                </Button>
              </div>
            </div>
          )}

          {tab === 'manual' && (
            <div className="space-y-4">
              <div className="rounded-xl bg-slate-950/50 p-3 text-sm text-slate-400">
                Ручной редактор подходит для быстрых тестовых датасетов и smoke test обучения.
              </div>

              {manualItems.map((item, idx) => (
                <div key={idx} className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                  <div className="mb-3 text-xs uppercase tracking-wide text-slate-500">Example #{idx + 1}</div>
                  <div className="grid gap-3">
                    <div>
                      <label className="mb-2 block text-xs text-slate-500">User</label>
                      <Textarea
                        className="min-h-[100px]"
                        value={item.user}
                        onChange={(e) => {
                          const next = [...manualItems];
                          next[idx] = { ...next[idx], user: e.target.value };
                          setManualItems(next);
                        }}
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-xs text-slate-500">Assistant</label>
                      <Textarea
                        className="min-h-[100px]"
                        value={item.assistant}
                        onChange={(e) => {
                          const next = [...manualItems];
                          next[idx] = { ...next[idx], assistant: e.target.value };
                          setManualItems(next);
                        }}
                      />
                    </div>
                  </div>
                  <div className="mt-3">
                    <button
                      onClick={() => setManualItems((prev) => prev.filter((_, i) => i !== idx))}
                      className="text-sm text-rose-400 hover:text-rose-300"
                    >
                      Remove example
                    </button>
                  </div>
                </div>
              ))}

              <div className="flex flex-wrap gap-3">
                <Button
                  className="bg-slate-800 hover:bg-slate-700"
                  onClick={() => setManualItems((prev) => [...prev, { user: '', assistant: '' }])}
                >
                  Add example
                </Button>
                <Button
                  onClick={createFromManual}
                  disabled={!name.trim() || createItemsMutation.isPending}
                >
                  Create dataset
                </Button>
              </div>
            </div>
          )}

          {(validateJsonlMutation.isError || createJsonlMutation.isError || createItemsMutation.isError) && (
            <div className="mt-4 rounded-xl border border-rose-900 bg-rose-950/40 p-3 text-sm text-rose-300">
              {String(
                validateJsonlMutation.error?.message ||
                  createJsonlMutation.error?.message ||
                  createItemsMutation.error?.message ||
                  'Unknown error',
              )}
            </div>
          )}
        </Card>

        <Card title="Validation / preview">
          {!validation ? (
            <div className="space-y-3 text-sm text-slate-500">
              <div>
                Для JSONL нажми <span className="text-white">Validate</span>, чтобы увидеть распознанный формат, ошибки и примеры.
              </div>
              <div className="rounded-xl bg-slate-950/50 p-3">
                <div className="font-medium text-white">Поддерживаемые форматы</div>
                <div className="mt-2">1. messages[]</div>
                <div>2. instruction / input / output</div>
                <div>3. prompt / completion</div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl bg-slate-950/50 p-3">
                  <div className="text-slate-500">Format</div>
                  <div className="mt-1 text-white">{validation.detectedFormat}</div>
                </div>
                <div className="rounded-xl bg-slate-950/50 p-3">
                  <div className="text-slate-500">Valid</div>
                  <div className="mt-1 text-white">{validation.validCount}</div>
                </div>
                <div className="rounded-xl bg-slate-950/50 p-3">
                  <div className="text-slate-500">Invalid</div>
                  <div className="mt-1 text-white">{validation.invalidCount}</div>
                </div>
                <div className="rounded-xl bg-slate-950/50 p-3">
                  <div className="text-slate-500">Lines</div>
                  <div className="mt-1 text-white">{validation.totalLines ?? '—'}</div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-3 text-sm text-slate-400">
                {validation.ok
                  ? 'Формат распознан, есть валидные строки. Можно сохранять dataset.'
                  : 'Валидных строк нет. Исправь ошибки и попробуй ещё раз.'}
              </div>

              <div>
                <div className="mb-2 text-sm font-medium text-white">Preview</div>
                <div className="space-y-3">
                  {validation.preview.map((item, idx) => (
                    <pre
                      key={idx}
                      className="overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-300"
                    >
                      {JSON.stringify(item, null, 2)}
                    </pre>
                  ))}
                </div>
              </div>

              {!!validation.errors.length && (
                <div>
                  <div className="mb-2 text-sm font-medium text-rose-300">Errors</div>
                  <div className="space-y-2">
                    {validation.errors.map((err, idx) => (
                      <div key={idx} className="rounded-xl border border-rose-900 bg-rose-950/30 p-3 text-xs text-rose-200">
                        {err.line ? `Line ${err.line}: ` : err.index !== undefined ? `Item ${err.index}: ` : ''}
                        {err.error}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      <Card title="Saved datasets">
        {datasetsQuery.isLoading ? (
          <div className="text-sm text-slate-500">Loading…</div>
        ) : !sorted.length ? (
          <div className="text-sm text-slate-500">No datasets yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-slate-500">
                <tr>
                  <th className="pb-3 pr-4">Name</th>
                  <th className="pb-3 pr-4">Rows</th>
                  <th className="pb-3 pr-4">Created</th>
                  <th className="pb-3 pr-4">Processed path</th>
                  <th className="pb-3 pr-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((ds) => (
                  <tr key={ds.id} className="border-t border-slate-800 align-top">
                    <td className="py-3 pr-4 text-white">{ds.name}</td>
                    <td className="py-3 pr-4 text-slate-300">{ds.rows}</td>
                    <td className="py-3 pr-4 text-slate-300">{fmtDate(ds.createdAt)}</td>
                    <td className="py-3 pr-4 text-xs text-slate-500">{ds.processedPath}</td>
                    <td className="py-3 pr-4">
                      <div className="flex flex-wrap gap-2">
                        <Button className="bg-slate-800 hover:bg-slate-700" onClick={() => setPreviewDatasetId(ds.id)}>
                          Preview
                        </Button>
                        <Link
                          to={`/app/training?datasetId=${encodeURIComponent(ds.id)}`}
                          className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
                        >
                          Train
                        </Link>
                        <Button
                          className="bg-rose-700 hover:bg-rose-600"
                          onClick={() => deleteMutation.mutate(ds.id)}
                          disabled={deleteMutation.isPending}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Dataset preview">
        {!previewDatasetId ? (
          <div className="text-sm text-slate-500">Выбери dataset и нажми Preview.</div>
        ) : previewQuery.isLoading ? (
          <div className="text-sm text-slate-500">Loading preview…</div>
        ) : previewQuery.data ? (
          <div className="space-y-3">
            <div className="text-sm text-slate-400">
              <span className="text-white">{previewQuery.data.name}</span> · rows: {previewQuery.data.totalRows}
            </div>
            {previewQuery.data.preview.map((item, idx) => (
              <pre key={idx} className="overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-300">
                {JSON.stringify(item, null, 2)}
              </pre>
            ))}
          </div>
        ) : (
          <div className="text-sm text-slate-500">No preview available.</div>
        )}
      </Card>
    </div>
  );
}