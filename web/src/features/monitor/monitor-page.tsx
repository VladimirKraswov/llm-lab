import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type ManagedProcess } from '../../lib/api';
import { PageHeader } from '../../components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import {
  Cpu,
  MemoryStick,
  HardDrive,
  Network,
  Thermometer,
  Activity,
  ArrowUp,
  ArrowDown,
  Trash2,
  Eraser,
  Layers,
  Shield,
  Server,
} from 'lucide-react';
import { Button } from '../../components/ui/button';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import { useState, useEffect } from 'react';

function fmtBytes(bytes: number) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function percent(part?: number, total?: number) {
  const p = Number(part) || 0;
  const t = Number(total) || 0;
  if (!t) return 0;
  return (p / t) * 100;
}

function fmtDate(value?: string | null) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function UsageBar({
  value,
  label,
  color = 'bg-blue-600',
}: {
  value: number;
  label: string;
  color?: string;
}) {
  const safeValue = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs font-medium">
        <span className="text-slate-400">{label}</span>
        <span className="text-white">{safeValue.toFixed(1)}%</span>
      </div>
      <div className="h-2 w-full rounded-full bg-slate-800">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${Math.min(100, Math.max(0, safeValue))}%` }}
        />
      </div>
    </div>
  );
}

function ProcessTypeBadge({ type }: { type: string }) {
  const palette: Record<string, string> = {
    runtime: 'bg-blue-500/15 text-blue-300 border-blue-500/20',
    'fine-tune': 'bg-purple-500/15 text-purple-300 border-purple-500/20',
    'model-download': 'bg-cyan-500/15 text-cyan-300 border-cyan-500/20',
    'model-quantize': 'bg-orange-500/15 text-orange-300 border-orange-500/20',
    'lora-merge': 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20',
    'lora-package': 'bg-rose-500/15 text-rose-300 border-rose-500/20',
  };

  const cls = palette[type] || 'bg-slate-500/15 text-slate-300 border-slate-500/20';

  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${cls}`}>
      {type}
    </span>
  );
}

function renderMetaSummary(item: ManagedProcess) {
  const meta = item.meta || {};
  const parts: string[] = [];

  if (typeof meta.jobId === 'string') parts.push(`job: ${meta.jobId}`);
  if (typeof meta.modelId === 'string') parts.push(`model: ${meta.modelId}`);
  if (typeof meta.loraId === 'string') parts.push(`lora: ${meta.loraId}`);
  if (typeof meta.provider === 'string') parts.push(`provider: ${meta.provider}`);
  if (typeof meta.port === 'number') parts.push(`port: ${meta.port}`);

  return parts.length ? parts.join(' · ') : 'managed by service';
}

export default function MonitorPage() {
  const queryClient = useQueryClient();
  const [history, setHistory] = useState<any[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ['monitor-stats'],
    queryFn: api.getMonitorStats,
    refetchInterval: 2000,
  });

  const { data: managedProcesses = [] } = useQuery({
    queryKey: ['managed-processes'],
    queryFn: api.getManagedProcesses,
    refetchInterval: 3000,
  });

  const killMutation = useMutation({
    mutationFn: api.killProcess,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['monitor-stats'] });
      queryClient.invalidateQueries({ queryKey: ['managed-processes'] });
    },
  });

  const clearGpuMutation = useMutation({
    mutationFn: api.clearGpu,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['monitor-stats'] });
      queryClient.invalidateQueries({ queryKey: ['managed-processes'] });
    },
  });

  const cleanupManagedMutation = useMutation({
    mutationFn: () => api.cleanupManagedProcesses(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['monitor-stats'] });
      queryClient.invalidateQueries({ queryKey: ['managed-processes'] });
    },
  });

  useEffect(() => {
    if (data) {
      setHistory((prev) => {
        const next = [
          ...prev,
          {
            time: new Date().toLocaleTimeString(),
            cpu: data.cpu?.load || 0,
            mem: data.memory?.total ? (data.memory.used / data.memory.total) * 100 : 0,
            vram: percent(data.gpus?.[0]?.vramUsed, data.gpus?.[0]?.vram),
            gpu: data.gpus?.[0]?.utilizationGpu || 0,
          },
        ];
        return next.slice(-30);
      });
    }
  }, [data]);

  if (isLoading || !data) {
    return (
      <div className="flex h-[400px] items-center justify-center">
        <div className="text-slate-500">Gathering system data...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="System Monitoring"
        description="CPU, GPU, RAM, disks, network and managed service processes."
      />

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-5">
        <Card className="border-blue-500/20 bg-blue-500/5">
          <CardContent className="px-4 pt-6">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-blue-500/20 p-2 text-blue-400">
                <Cpu size={20} />
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">CPU</div>
                <div className="text-xl font-bold text-white">{(data.cpu?.load || 0).toFixed(1)}%</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-purple-500/20 bg-purple-500/5">
          <CardContent className="px-4 pt-6">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-purple-500/20 p-2 text-purple-400">
                <MemoryStick size={20} />
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">RAM</div>
                <div className="text-xl font-bold text-white">
                  {(data.memory?.total ? (data.memory.used / data.memory.total) * 100 : 0).toFixed(1)}%
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-cyan-500/20 bg-cyan-500/5">
          <CardContent className="px-4 pt-6">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-cyan-500/20 p-2 text-cyan-400">
                <Layers size={20} />
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">VRAM</div>
                <div className="text-xl font-bold text-white">
                  {percent(data.gpus?.[0]?.vramUsed, data.gpus?.[0]?.vram).toFixed(1)}%
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-emerald-500/20 bg-emerald-500/5">
          <CardContent className="px-4 pt-6">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-emerald-500/20 p-2 text-emerald-400">
                <Activity size={20} />
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">GPU Load</div>
                <div className="text-xl font-bold text-white">{data.gpus?.[0]?.utilizationGpu || 0}%</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-orange-500/20 bg-orange-500/5">
          <CardContent className="px-4 pt-6">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-orange-500/20 p-2 text-orange-400">
                <Thermometer size={20} />
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">GPU Temp</div>
                <div className="text-xl font-bold text-white">{data.gpus?.[0]?.temperatureGpu || 0}°C</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_350px]">
        <Card>
          <CardHeader>
            <CardTitle>Resource Utilization (Real-time)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={history}>
                  <defs>
                    <linearGradient id="colorCpu" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorMem" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="time" hide />
                  <YAxis stroke="#64748b" fontSize={12} tickFormatter={(v) => `${v}%`} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0f172a',
                      border: '1px solid #1e293b',
                      borderRadius: '8px',
                    }}
                    itemStyle={{ fontSize: '12px' }}
                  />
                  <Area type="monotone" dataKey="cpu" stroke="#3b82f6" fillOpacity={1} fill="url(#colorCpu)" name="CPU %" />
                  <Area type="monotone" dataKey="mem" stroke="#a855f7" fillOpacity={1} fill="url(#colorMem)" name="RAM %" />
                  <Area type="monotone" dataKey="vram" stroke="#06b6d4" fillOpacity={0} name="VRAM %" />
                  <Area type="monotone" dataKey="gpu" stroke="#10b981" fillOpacity={0} name="GPU %" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Memory Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex h-[150px] justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={[
                      { name: 'Used', value: data.memory.used },
                      { name: 'Free', value: data.memory.free },
                    ]}
                    innerRadius={40}
                    outerRadius={60}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    <Cell fill="#a855f7" />
                    <Cell fill="#1e293b" />
                  </Pie>
                  <Tooltip formatter={(v: number) => fmtBytes(v)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Total RAM</span>
                <span className="text-white">{fmtBytes(data.memory.total)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Active RAM</span>
                <span className="text-white">{fmtBytes(data.memory.active)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Swap Total</span>
                <span className="text-white">{fmtBytes(data.memory.swaptotal)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Swap Used</span>
                <span className="text-white">{fmtBytes(data.memory.swapused)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base">Storage Devices</CardTitle>
            <HardDrive className="text-slate-500" size={18} />
          </CardHeader>
          <CardContent className="space-y-4">
            {data.disks.map((disk, idx) => (
              <div key={idx} className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="font-medium text-white">
                    {disk.mount} ({disk.type})
                  </span>
                  <span className="text-slate-500">
                    {fmtBytes(disk.used)} / {fmtBytes(disk.size)}
                  </span>
                </div>
                <UsageBar
                  value={disk.use}
                  label={disk.fs}
                  color={disk.use > 80 ? 'bg-rose-500' : 'bg-blue-600'}
                />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base">Network Interfaces</CardTitle>
            <Network className="text-slate-500" size={18} />
          </CardHeader>
          <CardContent className="space-y-4">
            {data.network
              .filter((n) => n.operstate === 'up')
              .map((net, idx) => (
                <div key={idx} className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                  <div className="mb-3 flex justify-between">
                    <span className="text-sm font-semibold uppercase text-white">{net.iface}</span>
                    <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] uppercase text-emerald-400">
                      Online
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex items-center gap-2">
                      <div className="rounded-lg bg-blue-500/10 p-1.5 text-blue-400">
                        <ArrowDown size={14} />
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-tighter text-slate-500">Down</div>
                        <div className="font-mono text-xs text-white">{fmtBytes(net.rx_sec)}/s</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="rounded-lg bg-purple-500/10 p-1.5 text-purple-400">
                        <ArrowUp size={14} />
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-tighter text-slate-500">Up</div>
                        <div className="font-mono text-xs text-white">{fmtBytes(net.tx_sec)}/s</div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
          </CardContent>
        </Card>
      </div>

      <Card className="border-emerald-500/20">
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield size={18} className="text-emerald-400" />
            <CardTitle>Managed Service Processes</CardTitle>
          </div>
          <Button
            className="h-9 gap-2 bg-emerald-700 px-3 text-xs hover:bg-emerald-600"
            onClick={() => {
              if (confirm('Clean up managed service processes only?')) {
                cleanupManagedMutation.mutate();
              }
            }}
            disabled={cleanupManagedMutation.isPending}
          >
            <Eraser size={16} />
            Safe Cleanup
          </Button>
        </CardHeader>
        <CardContent>
          <div className="mb-4 text-sm text-slate-400">
            This action affects only processes started and tracked by the service registry.
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-slate-500">
                  <th className="pb-3 font-medium">PID</th>
                  <th className="pb-3 font-medium">Type</th>
                  <th className="pb-3 font-medium">Label</th>
                  <th className="pb-3 font-medium">Details</th>
                  <th className="pb-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {managedProcesses.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-500">
                      No managed processes registered.
                    </td>
                  </tr>
                ) : (
                  managedProcesses.map((proc) => (
                    <tr key={proc.pid} className="hover:bg-slate-800/30">
                      <td className="py-3 font-mono text-slate-300">{proc.pid}</td>
                      <td className="py-3">
                        <ProcessTypeBadge type={proc.type} />
                      </td>
                      <td className="py-3 text-white">{proc.label || '—'}</td>
                      <td className="py-3 text-xs text-slate-400">{renderMetaSummary(proc)}</td>
                      <td className="py-3 text-xs text-slate-500">{fmtDate(proc.createdAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <Server size={18} className="text-slate-400" />
            <CardTitle>System GPU Processes</CardTitle>
          </div>
          <div className="flex gap-2">
            <Button
              className="h-9 gap-2 bg-amber-700 px-3 text-xs hover:bg-amber-600"
              onClick={() => {
                if (
                  confirm(
                    'Run legacy GPU cleanup? This may kill broader ML-related processes depending on backend implementation.'
                  )
                ) {
                  clearGpuMutation.mutate();
                }
              }}
              disabled={clearGpuMutation.isPending}
            >
              <Eraser size={16} />
              Legacy GPU Cleanup
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4 text-sm text-slate-400">
            Raw process list from system monitoring. Use individual kill only when you know exactly what you are stopping.
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-slate-500">
                  <th className="pb-3 font-medium">PID</th>
                  <th className="pb-3 font-medium">Process</th>
                  <th className="pb-3 font-medium">CPU %</th>
                  <th className="pb-3 font-medium">RAM %</th>
                  <th className="pb-3 font-medium">User</th>
                  <th className="pb-3 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {data.gpuProcesses.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-500">
                      No active GPU processes detected.
                    </td>
                  </tr>
                ) : (
                  data.gpuProcesses.map((proc) => (
                    <tr key={proc.pid} className="group hover:bg-slate-800/30">
                      <td className="py-3 font-mono text-slate-400">{proc.pid}</td>
                      <td className="py-3">
                        <div className="font-medium text-white">{proc.name}</div>
                        <div className="max-w-md truncate text-[10px] text-slate-500">{proc.command}</div>
                      </td>
                      <td className="py-3 text-slate-300">{proc.cpu.toFixed(1)}%</td>
                      <td className="py-3 text-slate-300">{proc.mem.toFixed(1)}%</td>
                      <td className="py-3 text-slate-400">{proc.user}</td>
                      <td className="py-3 text-right">
                        <Button
                          className="h-8 w-8 border-none bg-transparent p-0 text-slate-500 shadow-none hover:text-rose-500"
                          onClick={() => {
                            if (confirm(`Kill process ${proc.pid} (${proc.name})?`)) {
                              killMutation.mutate(proc.pid);
                            }
                          }}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {data.gpus.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>GPU Accelerators</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.gpus.map((gpu, idx) => (
              <div
                key={idx}
                className="grid items-center gap-6 rounded-2xl border border-slate-800 bg-slate-950/40 p-5 md:grid-cols-[1fr_2fr_1fr]"
              >
                <div>
                  <div className="mb-1 text-xs uppercase tracking-wider text-slate-500">{gpu.vendor}</div>
                  <div className="text-lg font-bold leading-tight text-white">{gpu.model}</div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <UsageBar value={gpu.utilizationGpu} label="GPU Utilization" color="bg-emerald-500" />
                  <UsageBar value={percent(gpu.vramUsed, gpu.vram)} label="VRAM Usage" color="bg-cyan-500" />
                </div>
                <div className="flex flex-col items-end gap-1">
                  <div className="text-xs uppercase tracking-tighter text-slate-500">VRAM</div>
                  <div className="text-sm font-mono text-white">
                    {gpu.vramUsed} / {gpu.vram} MB
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}