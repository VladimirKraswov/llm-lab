import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';

export default function WorkersPage() {
  const workersQuery = useQuery({
    queryKey: ['workers'],
    queryFn: api.getWorkers,
    refetchInterval: 5000,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="GPU Workers"
        description="Monitor status and resource usage of remote GPU servers."
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {workersQuery.isLoading ? (
          <div className="text-slate-500">Loading workers...</div>
        ) : !workersQuery.data?.length ? (
          <div className="col-span-full rounded-2xl border border-dashed border-slate-800 p-12 text-center">
             <div className="text-slate-400">No workers registered yet.</div>
             <div className="mt-2 text-xs text-slate-600">
               Launch a <code>trainer-agent</code> on your GPU server to see it here.
             </div>
          </div>
        ) : (
          workersQuery.data.map((worker) => (
            <Card key={worker.id} className={worker.status === 'offline' ? 'opacity-60' : ''}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{worker.name}</CardTitle>
                <span className={`h-2 w-2 rounded-full ${
                  worker.status === 'online' ? 'bg-emerald-500' :
                  worker.status === 'busy' ? 'bg-blue-500' : 'bg-slate-500'
                }`} />
              </CardHeader>
              <CardContent>
                <div className="text-xs font-mono text-slate-500 mb-4">{worker.id}</div>

                <div className="space-y-3">
                   <div className="flex justify-between text-xs">
                      <span className="text-slate-400">Status</span>
                      <span className="capitalize text-white font-bold">{worker.status}</span>
                   </div>
                   <div className="flex justify-between text-xs">
                      <span className="text-slate-400">Last Heartbeat</span>
                      <span className="text-white">{new Date(worker.lastHeartbeat).toLocaleTimeString()}</span>
                   </div>

                   {worker.resources?.gpus && (
                     <div className="pt-2 border-t border-slate-800">
                        <div className="text-[10px] uppercase font-bold text-slate-500 mb-1">GPUs</div>
                        {worker.resources.gpus.map((gpu: any, idx: number) => (
                          <div key={idx} className="flex justify-between text-[11px] py-0.5">
                             <span className="text-slate-300 truncate max-w-[140px]">{gpu.name}</span>
                             <span className="text-slate-400">{Math.round(gpu.memory / 1024)}GB</span>
                          </div>
                        ))}
                     </div>
                   )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
