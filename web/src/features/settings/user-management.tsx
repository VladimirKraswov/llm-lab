import { useState } from 'react';
import { api } from '../../lib/api';
import { toast } from 'sonner';
import { UserPlus, Shield, User as UserIcon, X } from 'lucide-react';

export default function UserManagement() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      toast.error('Username and password are required');
      return;
    }

    setIsSubmitting(true);
    try {
      await api.createUser({ username, password, role });
      toast.success(`User ${username} created successfully`);
      setUsername('');
      setPassword('');
      setRole('member');
      setShowForm(false);
    } catch (err: any) {
      toast.error(err.message || 'Failed to create user');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-white">User Management</h2>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm transition-colors"
          >
            <UserPlus size={18} />
            Add User
          </button>
        )}
      </div>

      {showForm && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 relative">
          <button
            onClick={() => setShowForm(false)}
            className="absolute top-4 right-4 text-zinc-500 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>

          <h3 className="text-lg font-medium text-white mb-6 flex items-center gap-2">
            <UserPlus size={20} className="text-blue-400" />
            Create New User
          </h3>

          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium text-zinc-400">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="Enter username"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-zinc-400">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="Enter password"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-zinc-400">Role</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setRole('member')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg border transition-all ${
                    role === 'member'
                      ? 'bg-blue-600/10 border-blue-600 text-blue-400'
                      : 'bg-zinc-950 border-zinc-800 text-zinc-500 hover:border-zinc-700'
                  }`}
                >
                  <UserIcon size={16} />
                  Member
                </button>
                <button
                  type="button"
                  onClick={() => setRole('admin')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg border transition-all ${
                    role === 'admin'
                      ? 'bg-purple-600/10 border-purple-600 text-purple-400'
                      : 'bg-zinc-950 border-zinc-800 text-zinc-500 hover:border-zinc-700'
                  }`}
                >
                  <Shield size={16} />
                  Admin
                </button>
              </div>
            </div>

            <div className="md:col-span-2 pt-2">
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:opacity-50 text-white font-medium py-2 rounded-lg transition-colors"
              >
                {isSubmitting ? 'Creating...' : 'Create User'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
