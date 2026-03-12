import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { RefreshCw, Users, Activity, AlertTriangle, CheckCircle, Clock, Trash2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Toast } from "@/components/ui/toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface PoolStatus {
  summary: {
    total: number;
    active: number;
    limited: number;
    error: number;
    disabled: number;
    totalConcurrency: number;
    availableConcurrency: number;
    totalUsagePercentage: number;
  };
  accounts: Array<{
    id: string;
    name: string;
    status: string;
    concurrency: {
      current: number;
      max: number;
      availableSlots: number;
    };
    usage: {
      last5Hours: number;
      last5HoursLimit: number;
      usagePercent: number;
      weekly: number;
      weeklyLimit: number;
    };
    boundSessions: number;
    lastUsedAt?: string;
    limitedInfo?: {
      since: string;
      reason: string;
      errorMessage?: string;
      recoverAt?: string;
    };
  }>;
  bindings: {
    total: number;
    ttlMinutes: number;
  };
}

interface Binding {
  sessionId: string;
  accountId: string;
  createdAt: string;
  lastActiveAt: string;
  updatedAt?: string;
  ttlMinutes: number;
}

export function PoolStatusPage() {
  const { t } = useTranslation();
  const [poolStatus, setPoolStatus] = useState<PoolStatus | null>(null);
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'warning' } | null>(null);
  const [clearingBindings, setClearingBindings] = useState(false);
  const [confirmClearDialog, setConfirmClearDialog] = useState(false);

  const fetchPoolStatus = async () => {
    try {
      setLoading(true);
      setError(null);

      const [statusResponse, bindingsResponse] = await Promise.all([
        api.getPoolStatus(),
        api.getPoolBindings(),
      ]);

      setPoolStatus(statusResponse);
      setBindings(bindingsResponse.bindings);
    } catch (err) {
      console.error('Failed to fetch pool status:', err);
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPoolStatus();
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchPoolStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleClearBindings = async () => {
    try {
      setClearingBindings(true);
      await api.clearPoolBindings();
      setToast({ message: 'All bindings cleared successfully', type: 'success' });
      fetchPoolStatus();
    } catch (err) {
      setToast({ message: `Failed to clear bindings: ${(err as Error).message}`, type: 'error' });
    } finally {
      setClearingBindings(false);
      setConfirmClearDialog(false);
    }
  };

  const handleRemoveBinding = async (sessionId: string) => {
    try {
      await api.removePoolBinding(sessionId);
      setToast({ message: 'Binding removed successfully', type: 'success' });
      fetchPoolStatus();
    } catch (err) {
      setToast({ message: `Failed to remove binding: ${(err as Error).message}`, type: 'error' });
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-500';
      case 'limited':
        return 'bg-yellow-500';
      case 'error':
        return 'bg-red-500';
      case 'disabled':
        return 'bg-gray-500';
      default:
        return 'bg-gray-300';
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge className="bg-green-100 text-green-800 hover:bg-green-200">Active</Badge>;
      case 'limited':
        return <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-200">Limited</Badge>;
      case 'error':
        return <Badge className="bg-red-100 text-red-800 hover:bg-red-200">Error</Badge>;
      case 'disabled':
        return <Badge className="bg-gray-100 text-gray-800 hover:bg-gray-200">Disabled</Badge>;
      default:
        return <Badge>Unknown</Badge>;
    }
  };

  const formatTime = (dateString?: string) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    const now = Date.now();
    const elapsed = now - date.getTime();
    const minutes = Math.floor(elapsed / 60000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return date.toLocaleDateString();
  };

  const formatPercent = (percent: number) => {
    return `${percent.toFixed(1)}%`;
  };

  const getUsageColor = (percent: number) => {
    if (percent < 50) return 'bg-green-500';
    if (percent < 80) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  if (loading && !poolStatus) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500">Loading pool status...</div>
      </div>
    );
  }

  if (error && !poolStatus) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-red-500">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Pool Status</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchPoolStatus}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      {poolStatus && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Accounts</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{poolStatus.summary.total}</div>
              <div className="text-xs text-muted-foreground">
                {poolStatus.summary.active} active, {poolStatus.summary.limited} limited
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Concurrency</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {poolStatus.summary.availableConcurrency} / {poolStatus.summary.totalConcurrency}
              </div>
              <div className="text-xs text-muted-foreground">
                Available slots
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Usage (5h)</CardTitle>
              <CheckCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatPercent(poolStatus.summary.totalUsagePercentage)}</div>
              <div className="text-xs text-muted-foreground">
                Total usage percentage
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Session Bindings</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{poolStatus.bindings.total}</div>
              <div className="text-xs text-muted-foreground">
                TTL: {poolStatus.bindings.ttlMinutes} min
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Accounts Table */}
      <Card>
        <CardHeader>
          <CardTitle>Account Status</CardTitle>
        </CardHeader>
        <CardContent>
          {poolStatus && poolStatus.accounts.length === 0 ? (
            <div className="text-center text-gray-500 py-8">
              No accounts in pool
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Concurrency</TableHead>
                    <TableHead>Usage (5h)</TableHead>
                    <TableHead>Usage (Weekly)</TableHead>
                    <TableHead>Bound Sessions</TableHead>
                    <TableHead>Last Used</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {poolStatus?.accounts.map((account) => (
                    <TableRow key={account.id}>
                      <TableCell className="font-medium">
                        <div>
                          <div>{account.name}</div>
                          <div className="text-xs text-gray-500">{account.id}</div>
                        </div>
                      </TableCell>
                      <TableCell>{getStatusBadge(account.status)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span>{account.concurrency.current} / {account.concurrency.max}</span>
                          <div className="w-20 bg-gray-200 rounded-full h-2">
                            <div
                              className="bg-blue-500 h-2 rounded-full"
                              style={{ width: `${(account.concurrency.current / account.concurrency.max) * 100}%` }}
                            />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span>{formatPercent(account.usage.usagePercent)}</span>
                          <div className="w-20 bg-gray-200 rounded-full h-2">
                            <div
                              className={`h-2 rounded-full ${getUsageColor(account.usage.usagePercent)}`}
                              style={{ width: `${Math.min(account.usage.usagePercent, 100)}%` }}
                            />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {account.usage.weekly} / {account.usage.weeklyLimit}
                      </TableCell>
                      <TableCell>
                        {account.boundSessions > 0 ? (
                          <Badge variant="secondary">{account.boundSessions}</Badge>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </TableCell>
                      <TableCell>{formatTime(account.lastUsedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bindings Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Session Bindings</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirmClearDialog(true)}
            disabled={clearingBindings || bindings.length === 0}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Clear All
          </Button>
        </CardHeader>
        <CardContent>
          {bindings.length === 0 ? (
            <div className="text-center text-gray-500 py-8">
              No active bindings
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Session ID</TableHead>
                    <TableHead>Account ID</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Last Active</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bindings.map((binding) => (
                    <TableRow key={binding.sessionId}>
                      <TableCell className="font-mono text-sm">
                        {binding.sessionId.substring(0, 20)}...
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {binding.accountId}
                      </TableCell>
                      <TableCell>{formatTime(binding.createdAt)}</TableCell>
                      <TableCell>{formatTime(binding.lastActiveAt)}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveBinding(binding.sessionId)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Clear bindings confirmation dialog */}
      <Dialog open={confirmClearDialog} onOpenChange={setConfirmClearDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear All Bindings</DialogTitle>
            <DialogDescription>
              Are you sure you want to clear all {bindings.length} session bindings? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmClearDialog(false)}
              disabled={clearingBindings}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleClearBindings}
              disabled={clearingBindings}
            >
              {clearingBindings && <RefreshCw className="h-4 w-4 mr-2 animate-spin" />}
              Clear All
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
