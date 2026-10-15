import { createContext, ReactNode, useCallback, useContext, useMemo, useState } from "react";

/** What a notification is about, for its icon. */
export type NoticeKind = "synced" | "lowdisk" | "update" | "received" | "sent" | "failed";

export type AppNotice = {
  id: number;
  kind: NoticeKind;
  title: string;
  body: string;
  at: number;
  read: boolean;
};

type Ctx = {
  notices: AppNotice[];
  unread: number;
  push: (kind: NoticeKind, title: string, body: string) => void;
  markRead: () => void;
  clear: () => void;
};

const NoticeContext = createContext<Ctx>({
  notices: [],
  unread: 0,
  push: () => {},
  markRead: () => {},
  clear: () => {},
});

/** How many notifications are kept; the oldest go first. */
const KEEP = 50;
let nextId = 1;

/**
 * NotificationsProvider keeps what the app has had to tell the user while
 * it ran, newest first, for the top bar's notifications. They live as long
 * as the app runs.
 */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [notices, setNotices] = useState<AppNotice[]>([]);
  const push = useCallback((kind: NoticeKind, title: string, body: string) => {
    setNotices((n) => [{ id: nextId++, kind, title, body, at: Date.now(), read: false }, ...n].slice(0, KEEP));
  }, []);
  const markRead = useCallback(
    () => setNotices((n) => (n.some((x) => !x.read) ? n.map((x) => ({ ...x, read: true })) : n)),
    [],
  );
  const clear = useCallback(() => setNotices([]), []);
  const value = useMemo(
    () => ({ notices, unread: notices.filter((n) => !n.read).length, push, markRead, clear }),
    [notices, push, markRead, clear],
  );
  return <NoticeContext.Provider value={value}>{children}</NoticeContext.Provider>;
}

export const useNotifications = () => useContext(NoticeContext);
