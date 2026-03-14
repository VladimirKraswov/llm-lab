import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
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
  Layers
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
  if (bytes === 0) return '0 B';
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

function UsageBar({ value, label, color = 'bg-blue-600' }: { value: number, label: string, color?: string }) {
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

export default function MonitorPage() {
  const queryClient = useQueryClient();
  const [history, setHistory] = useState<any[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ['monitor-stats'],
    queryFn: api.getMonitorStats,
    refetchInterval: 2000,
  });

  const killMutation = useMutation({
    mutationFn: api.killProcess,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['monitor-stats'] }),
  });

  const clearGpuMutation = useMutation({
    mutationFn: api.clearGpu,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['monitor-stats'] }),
  });

  useEffect(() => {
    if (data) {
      setHistory((prev) => {
        const next = [...prev, {
          time: new Date().toLocaleTimeString(),
          cpu: data.cpu?.load || 0,
          mem: data.memory?.total ? (data.memory.used / data.memory.total) * 100 : 0,
          vram: percent(data.gpus?.[0]?.vramUsed, data.gpus?.[0]?.vram),
          gpu: data.gpus?.[0]?.utilizationGpu || 0,
        }];
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
        description="Ресурсы сервера: CPU, GPU, RAM, диски и сетевая активность."
      />

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-5">
        <Card className="border-blue-500/20 bg-blue-500/5">
          <CardContent className="pt-6 px-4">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-blue-500/20 p-2 text-blue-400">
                <Cpu size={20} />
              </div>
              <div>
                <div className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">CPU</div>
                <div className="text-xl font-bold text-white">{(data.cpu?.load || 0).toFixed(1)}%</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-purple-500/20 bg-purple-500/5">
          <CardContent className="pt-6 px-4">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-purple-500/20 p-2 text-purple-400">
                <MemoryStick size={20} />
              </div>
              <div>
                <div className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">RAM</div>
                <div className="text-xl font-bold text-white">
                  {(data.memory?.total ? (data.memory.used / data.memory.total) * 100 : 0).toFixed(1)}%
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-cyan-500/20 bg-cyan-500/5">
          <CardContent className="pt-6 px-4">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-cyan-500/20 p-2 text-cyan-400">
                <Layers size={20} />
              </div>
              <div>
                <div className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">VRAM</div>
                <div className="text-xl font-bold text-white">
                  {percent(data.gpus?.[0]?.vramUsed, data.gpus?.[0]?.vram).toFixed(1)}%
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-emerald-500/20 bg-emerald-500/5">
          <CardContent className="pt-6 px-4">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-emerald-500/20 p-2 text-emerald-400">
                <Activity size={20} />
              </div>
              <div>
                <div className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">GPU Load</div>
                <div className="text-xl font-bold text-white">{data.gpus?.[0]?.utilizationGpu || 0}%</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-orange-500/20 bg-orange-500/5">
          <CardContent className="pt-6 px-4">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-orange-500/20 p-2 text-orange-400">
                <Thermometer size={20} />
              </div>
              <div>
                <div className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">GPU Temp</div>
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
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorMem" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#a855f7" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="time" hide />
                  <YAxis stroke="#64748b" fontSize={12} tickFormatter={(v) => `${v}%`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px' }}
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
                  <span className="font-medium text-white">{disk.mount} ({disk.type})</span>
                  <span className="text-slate-500">{fmtBytes(disk.used)} / {fmtBytes(disk.size)}</span>
                </div>
                <UsageBar value={disk.use} label={disk.fs} color={disk.use > 80 ? 'bg-rose-500' : 'bg-blue-600'} />
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
            {data.network.filter((n) => n.operstate === 'up').map((net, idx) => (
              <div key={idx} className="rounded-xl bg-slate-950/40 p-4 border border-slate-800">
                <div className="flex justify-between mb-3">
                  <span className="text-sm font-semibold text-white uppercase">{net.iface}</span>
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full uppercase">Online</span>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-400"><ArrowDown size={14} /></div>
                    <div>
                      <div className="text-[10px] text-slate-500 uppercase tracking-tighter">Down</div>
                      <div className="text-xs font-mono text-white">{fmtBytes(net.rx_sec)}/s</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-purple-500/10 text-purple-400"><ArrowUp size={14} /></div>
                    <div>
                      <div className="text-[10px] text-slate-500 uppercase tracking-tighter">Up</div>
                      <div className="text-xs font-mono text-white">{fmtBytes(net.tx_sec)}/s</div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>GPU Processes & Control</CardTitle>
          <Button
            className="gap-2 h-9 px-3 text-xs bg-rose-700 hover:bg-rose-600"
            onClick={() => {
              if (confirm('Are you sure? This will kill all Python/vLLM processes on the system.')) {
                clearGpuMutation.mutate();
              }
            }}
            disabled={clearGpuMutation.isPending}
          >
            <Eraser size={16} />
            Clear GPU Memory
          </Button>
        </CardHeader>
        <CardContent>
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
                        <div className="text-[10px] text-slate-500 truncate max-w-md">{proc.command}</div>
                      </td>
                      <td className="py-3 text-slate-300">{proc.cpu.toFixed(1)}%</td>
                      <td className="py-3 text-slate-300">{proc.mem.toFixed(1)}%</td>
                      <td className="py-3 text-slate-400">{proc.user}</td>
                      <td className="py-3 text-right">
                        <Button
                          className="h-8 w-8 p-0 text-slate-500 hover:text-rose-500 bg-transparent border-none shadow-none"
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
              <div key={idx} className="grid gap-6 md:grid-cols-[1fr_2fr_1fr] items-center rounded-2xl border border-slate-800 bg-slate-950/40 p-5">
                <div>
                  <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">{gpu.vendor}</div>
                  <div className="text-lg font-bold text-white leading-tight">{gpu.model}</div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <UsageBar value={gpu.utilizationGpu} label="GPU Utilization" color="bg-emerald-500" />
                  <UsageBar value={percent(gpu.vramUsed, gpu.vram)} label="VRAM Usage" color="bg-cyan-500" />
                </div>
                <div className="flex flex-col items-end gap-1">
                  <div className="text-xs text-slate-500 uppercase tracking-tighter">VRAM</div>
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