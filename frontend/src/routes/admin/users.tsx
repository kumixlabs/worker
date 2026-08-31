import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Ban, KeyRound, LogIn, MoreHorizontal, Pencil, Plus, Shield, Trash2 } from "lucide-react";
import { useTranslations } from "use-intl";

import { ConfirmDialog } from "@kumix/ui/custom/confirm-dialog";
import { toastError } from "@kumix/ui/custom/toast";
import { Alert, AlertTitle } from "@kumix/ui/reui/alert";
import { Badge } from "@kumix/ui/reui/badge";
import { Button } from "@kumix/ui/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@kumix/ui/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@kumix/ui/ui/dropdown-menu";
import { Input } from "@kumix/ui/ui/input";
import { Label } from "@kumix/ui/ui/label";
import { AdminShell } from "@/components/AdminShell";
import { DataTable, type GridColumnDef } from "@/components/DataTable";
import { api, queryClient } from "@/lib/api";
import { authClient } from "@/lib/auth";
import { useDateTimeFormatter } from "@/lib/date";
import { formatBytes } from "@/lib/format";

type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: string | null;
  banned: boolean;
  maxStorageBytes: number | null;
  maxStreams: number | null;
  createdAt: number;
  usage: {
    storageBytes: number;
    storageQuota: number | null;
    streamCount: number;
    streamQuota: number | null;
  };
};

export function UsersPage() {
  const t = useTranslations("Users");
  const common = useTranslations("Common");

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [bulkDeleteIds, setBulkDeleteIds] = useState<string[]>([]);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);

  // Form states
  const [createEmail, setCreateEmail] = useState("");
  const [createName, setCreateName] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createRole, setCreateRole] = useState<"user" | "admin">("user");
  const [createStorageGb, setCreateStorageGb] = useState("");
  const [createMaxStreams, setCreateMaxStreams] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState<"user" | "admin">("user");
  const [editStorageGb, setEditStorageGb] = useState("");
  const [editMaxStreams, setEditMaxStreams] = useState("");

  const [newPassword, setNewPassword] = useState("");

  const { data: session } = authClient.useSession();
  const dateFormatter = useDateTimeFormatter();
  const currentUser = session?.user;
  const editSelf = Boolean(currentUser?.id && selectedUser?.id === currentUser.id);

  const usersQuery = useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const res = await api.getAdminUsers();
      return res as AdminUser[];
    },
    enabled: currentUser?.role === "admin",
  });

  const createUserMutation = useMutation({
    mutationFn: async () => {
      setErrorMsg("");
      const storageBytes = createStorageGb ? Math.round(Number(createStorageGb) * 1024 ** 3) : null;
      const streams = createMaxStreams ? Number(createMaxStreams) : null;
      const res = await authClient.admin.createUser({
        email: createEmail,
        password: createPassword,
        name: createName || "User",
        role: createRole,
        data: {
          maxStorageBytes: storageBytes,
          maxStreams: streams,
        },
      });
      if (res.error) throw new Error(res.error.message || "Failed to create user");
    },
    onSuccess: () => {
      setCreateOpen(false);
      setCreateEmail("");
      setCreateName("");
      setCreatePassword("");
      setCreateStorageGb("");
      setCreateMaxStreams("");
      void queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (err) => setErrorMsg(err.message),
  });

  const editMutation = useMutation({
    mutationFn: async () => {
      if (!selectedUser) return;
      // Quotas first: updateUser can demote the caller (admin -> user) and
      // kill access to /api/admin/* mid-flight.
      const storageBytes = editStorageGb ? Math.round(Number(editStorageGb) * 1024 ** 3) : null;
      const streams = editMaxStreams ? Number(editMaxStreams) : null;
      await api.patchAdminUserQuotas(selectedUser.id, {
        maxStorageBytes: storageBytes,
        maxStreams: streams,
      });
      const res = await authClient.admin.updateUser({
        userId: selectedUser.id,
        data: {
          name: editName || undefined,
          email: editEmail || undefined,
          role: editRole,
        },
      });
      if (res.error) throw new Error(res.error.message || "Failed to update user");
    },
    onSuccess: () => {
      setEditOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (err) => setErrorMsg(err.message),
  });

  const passwordMutation = useMutation({
    mutationFn: async () => {
      if (!selectedUser) return;
      const res = await authClient.admin.setUserPassword({
        userId: selectedUser.id,
        newPassword,
      });
      if (res.error) throw new Error(res.error.message || "Failed to set password");
    },
    onSuccess: () => {
      setPasswordOpen(false);
      setNewPassword("");
    },
    onError: (err) => setErrorMsg(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.deleteAdminUser(id);
    },
    onSuccess: () => {
      setDeleteTarget(null);
      void queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (err) => setErrorMsg(err.message),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => api.deleteAdminUser(id)));
    },
    onSuccess: () => {
      setBulkDeleteIds([]);
      void queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (err) => {
      setBulkDeleteIds([]);
      void queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      setErrorMsg(err.message);
    },
  });

  const banMutation = useMutation({
    mutationFn: async (u: AdminUser) => {
      if (u.banned) {
        const res = await authClient.admin.unbanUser({ userId: u.id });
        if (res.error) throw new Error(res.error.message || "Failed to unban user");
      } else {
        const res = await authClient.admin.banUser({ userId: u.id });
        if (res.error) throw new Error(res.error.message || "Failed to ban user");
      }
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["admin-users"] }),
    onError: (err) => toastError({ message: err.message }),
  });

  const impersonate = async (u: AdminUser) => {
    try {
      const res = await authClient.admin.impersonateUser({ userId: u.id });
      if (res.error) throw new Error(res.error.message || "Failed to impersonate user");
      window.location.href = "/";
    } catch (err) {
      toastError({ message: err instanceof Error ? err.message : "Failed to impersonate user" });
    }
  };

  const openEdit = (u: AdminUser) => {
    setSelectedUser(u);
    setEditName(u.name ?? "");
    setEditEmail(u.email ?? "");
    setEditRole(u.role === "admin" ? "admin" : "user");
    setEditStorageGb(
      u.maxStorageBytes ? (u.maxStorageBytes / 1024 ** 3).toFixed(1).replace(/\.0$/, "") : "",
    );
    setEditMaxStreams(u.maxStreams !== null ? String(u.maxStreams) : "");
    setErrorMsg("");
    setEditOpen(true);
  };

  const openPassword = (u: AdminUser) => {
    setSelectedUser(u);
    setNewPassword("");
    setErrorMsg("");
    setPasswordOpen(true);
  };

  const columns: GridColumnDef<AdminUser>[] = [
    {
      accessorKey: "name",
      header: t("user"),
      size: 260,
      cell: ({ row }) => {
        const u = row.original;
        return (
          <div className="flex min-w-0 flex-col">
            <span className="flex items-center gap-1.5">
              <span
                className={`truncate font-medium ${u.banned ? "text-destructive" : "text-foreground"}`}
              >
                {u.name}
              </span>
              {u.banned ? <Badge variant="destructive">{t("banned")}</Badge> : null}
            </span>
            <span className="truncate text-muted-foreground text-xs">{u.email}</span>
          </div>
        );
      },
    },
    {
      accessorKey: "role",
      header: t("role"),
      size: 110,
      cell: ({ row }) => {
        const u = row.original;
        return (
          <Badge variant={u.role === "admin" ? "default" : "secondary"}>
            {u.role === "admin" ? <Shield className="mr-1 size-3" /> : null}
            {u.role === "admin" ? "Admin" : "User"}
          </Badge>
        );
      },
    },
    {
      id: "storage",
      header: t("storage"),
      size: 150,
      cell: ({ row }) => {
        const u = row.original;
        const used = formatBytes(u.usage?.storageBytes ?? 0);
        const quota = u.maxStorageBytes ? formatBytes(u.maxStorageBytes) : t("unlimited");
        return (
          <span className="text-xs">
            {used} / {quota}
          </span>
        );
      },
    },
    {
      id: "streams",
      header: t("streams"),
      size: 120,
      cell: ({ row }) => {
        const u = row.original;
        const count = u.usage?.streamCount ?? 0;
        const quota = u.maxStreams !== null ? u.maxStreams : t("unlimited");
        return (
          <span className="text-xs">
            {count} / {quota}
          </span>
        );
      },
    },
    {
      accessorKey: "createdAt",
      header: t("createdAtColumn"),
      cell: ({ row }) => dateFormatter.format(new Date(row.original.createdAt)),
    },
    {
      id: "actions",
      header: common("actions"),
      size: 64,
      cell: ({ row }) => {
        const u = row.original;
        const isSelf = currentUser?.id === u.id;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={common("actions")}
                />
              }
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {!isSelf && (
                <DropdownMenuItem className="gap-2" onClick={() => void impersonate(u)}>
                  <LogIn className="size-4 text-muted-foreground" />
                  {t("impersonate")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem className="gap-2" onClick={() => openEdit(u)}>
                <Pencil className="size-4 text-muted-foreground" />
                {t("editUser")}
              </DropdownMenuItem>
              <DropdownMenuItem className="gap-2" onClick={() => openPassword(u)}>
                <KeyRound className="size-4 text-muted-foreground" />
                {t("changePassword")}
              </DropdownMenuItem>
              {!isSelf && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="gap-2" onClick={() => banMutation.mutate(u)}>
                    <Ban className={`size-4 ${u.banned ? "" : "text-muted-foreground"}`} />
                    {u.banned ? t("unban") : t("ban")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    className="gap-2"
                    onClick={() => setDeleteTarget(u)}
                  >
                    <Trash2 className="size-4" />
                    {common("delete")}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return (
    <AdminShell title={t("title")} description={t("description")}>
      {usersQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>{common("loadError")}</AlertTitle>
        </Alert>
      ) : null}

      {errorMsg && (
        <Alert variant="destructive">
          <AlertTitle>{errorMsg}</AlertTitle>
        </Alert>
      )}

      <DataTable
        data={usersQuery.data ?? []}
        empty={<span className="text-muted-foreground text-sm">{t("noUsers")}</span>}
        columns={columns}
        isLoading={usersQuery.isLoading}
        searchPlaceholder={common("search")}
        clearSearchLabel={common("clearSearch")}
        selectedActionLabel={common("deleteSelected")}
        onDeleteSelected={(ids) => setBulkDeleteIds(ids)}
        getCanSelectRow={(u) => u.id !== currentUser?.id}
        actions={
          <Button onClick={() => setCreateOpen(true)} className="gap-2">
            <Plus className="size-4" />
            {t("createUser")}
          </Button>
        }
      />

      {/* Create User Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("createUser")}</DialogTitle>
            <DialogDescription>{t("createUserDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid gap-1.5">
              <Label>{t("email")}</Label>
              <Input
                type="email"
                value={createEmail}
                onChange={(e) => setCreateEmail(e.target.value)}
                placeholder="user@example.com"
                required
              />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("name")}</Label>
              <Input
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="John Doe"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("password")}</Label>
              <Input
                type="password"
                value={createPassword}
                onChange={(e) => setCreatePassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("role")}</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={createRole === "user" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setCreateRole("user")}
                >
                  User
                </Button>
                <Button
                  type="button"
                  variant={createRole === "admin" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setCreateRole("admin")}
                >
                  Admin
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-1.5">
                <Label>{t("storageQuotaGb")}</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.5"
                  value={createStorageGb}
                  onChange={(e) => setCreateStorageGb(e.target.value)}
                  placeholder={t("unlimited")}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>{t("maxStreams")}</Label>
                <Input
                  type="number"
                  min="0"
                  value={createMaxStreams}
                  onChange={(e) => setCreateMaxStreams(e.target.value)}
                  placeholder={t("unlimited")}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {common("cancel")}
            </Button>
            <Button
              onClick={() => createUserMutation.mutate()}
              disabled={createUserMutation.isPending || !createEmail || !createPassword}
            >
              {common("create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("editUser")}: {selectedUser?.name}
            </DialogTitle>
            <DialogDescription>
              {t("editUserDesc", { name: selectedUser?.name ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid gap-1.5">
              <Label>{t("name")}</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("email")}</Label>
              <Input
                type="email"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("role")}</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={editRole === "user" ? "default" : "outline"}
                  size="sm"
                  disabled={editSelf}
                  onClick={() => setEditRole("user")}
                >
                  User
                </Button>
                <Button
                  type="button"
                  variant={editRole === "admin" ? "default" : "outline"}
                  size="sm"
                  disabled={editSelf}
                  onClick={() => setEditRole("admin")}
                >
                  Admin
                </Button>
              </div>
              {editSelf ? (
                <p className="text-muted-foreground text-xs">{t("selfRoleLocked")}</p>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-1.5">
                <Label>{t("storageQuotaGb")}</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.5"
                  value={editStorageGb}
                  onChange={(e) => setEditStorageGb(e.target.value)}
                  placeholder={t("unlimited")}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>{t("maxStreams")}</Label>
                <Input
                  type="number"
                  min="0"
                  value={editMaxStreams}
                  onChange={(e) => setEditMaxStreams(e.target.value)}
                  placeholder={t("unlimited")}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              {common("cancel")}
            </Button>
            <Button onClick={() => editMutation.mutate()} disabled={editMutation.isPending}>
              {common("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={passwordOpen} onOpenChange={setPasswordOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("changePassword")}: {selectedUser?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label>{t("newPassword")}</Label>
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasswordOpen(false)}>
              {common("cancel")}
            </Button>
            <Button
              onClick={() => passwordMutation.mutate()}
              disabled={passwordMutation.isPending || !newPassword}
            >
              {common("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete User Confirm */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t("deleteUserTitle")}
        description={t("deleteUserDesc", { name: deleteTarget?.name ?? "" })}
        confirmText={common("delete")}
        cancelText={common("cancel")}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
        }}
      />

      {/* Bulk Delete Confirm */}
      <ConfirmDialog
        open={bulkDeleteIds.length > 0}
        onOpenChange={(open) => !open && setBulkDeleteIds([])}
        title={t("deleteSelectedTitle")}
        description={t("deleteSelectedDesc", { count: bulkDeleteIds.length })}
        confirmText={common("delete")}
        cancelText={common("cancel")}
        onConfirm={() => bulkDeleteMutation.mutate(bulkDeleteIds)}
      />
    </AdminShell>
  );
}
