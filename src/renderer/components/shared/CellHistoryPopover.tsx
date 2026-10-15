import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Clock } from 'lucide-react';
import { IPC } from '../../../shared/ipc-channels';
import { parseDbTimestamp } from '../../../shared/dates';
import { safeInvoke } from '../../utils/safeInvoke';
import { dropdownVariants } from '../../utils/animations';

interface CellHistoryEntry {
  old_value: string | null;
  new_value: string | null;
  changed_at: string;
}

interface CellHistoryPopoverProps {
  rowId: number;
  columnId: number;
  columnName: string;
  x: number;
  y: number;
  onClose: () => void;
}

function formatRelativeTime(dateStr: string): string {
  // SQLite times are UTC with no zone mark (L-29)
  const date = parseDbTimestamp(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return 'Just now';
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? '' : 's'} ago`;
  if (diffDay === 1) return 'Yesterday';
  if (diffDay < 7) return `${diffDay} days ago`;
  if (diffDay < 30) {
    const weeks = Math.floor(diffDay / 7);
    return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
  }
  if (diffDay < 365) {
    const months = Math.floor(diffDay / 30);
    return `${months} month${months === 1 ? '' : 's'} ago`;
  }
  const years = Math.floor(diffDay / 365);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

function displayValue(val: string | null): string {
  if (val === null || val === '') return '(empty)';
  return val;
}

export function CellHistoryPopover({
  rowId,
  columnId,
  columnName,
  x,
  y,
  onClose,
}: CellHistoryPopoverProps) {
  const [history, setHistory] = useState<CellHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchHistory() {
      try {
        const result = await safeInvoke<CellHistoryEntry[]>(
          IPC.CELL_GET_HISTORY,
          rowId,
          columnId
        );
        if (cancelled) return;
        if (result.ok) {
          setHistory(result.data);
        } else {
          setError("We couldn't load this cell's history — try again");
        }
      } catch {
        if (!cancelled) {
          setError("We couldn't load this cell's history — try again");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchHistory();
    return () => {
      cancelled = true;
    };
  }, [rowId, columnId]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
    <motion.div
      ref={popoverRef}
      className="fixed z-50 w-80 rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-800"
      style={{
        left: x,
        top: y,
        maxHeight: 320,
      }}
      variants={dropdownVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
        <Clock size={16} className="text-gray-500 dark:text-gray-400" />
        <span
          className="font-medium text-gray-900 dark:text-gray-100"
          style={{ fontSize: 15 }}
        >
          History: {columnName}
        </span>
      </div>

      {/* Content */}
      <div className="overflow-y-auto" style={{ maxHeight: 320 - 48 }}>
        {loading && (
          <div
            className="flex items-center justify-center py-8 text-gray-500 dark:text-gray-400"
            style={{ fontSize: 15 }}
          >
            Loading…
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="px-4 py-8 text-center text-red-600 dark:text-red-400"
            style={{ fontSize: 15 }}
          >
            {error}
          </div>
        )}

        {!loading && !error && history.length === 0 && (
          <div
            className="px-4 py-8 text-center text-gray-500 dark:text-gray-400"
            style={{ fontSize: 15 }}
          >
            No edit history for this cell.
          </div>
        )}

        {!loading &&
          !error &&
          history.length > 0 &&
          history.map((entry, idx) => (
            <div
              key={idx}
              className="border-b border-gray-100 px-4 py-3 last:border-b-0 dark:border-gray-700"
              style={{ minHeight: 44, fontSize: 15 }}
            >
              <div className="mb-1 text-sm text-gray-500 dark:text-gray-400">
                {formatRelativeTime(entry.changed_at)}
              </div>
              <div className="flex items-center gap-2 text-gray-900 dark:text-gray-100">
                <span className="truncate text-red-600 line-through dark:text-red-400">
                  {displayValue(entry.old_value)}
                </span>
                <span className="shrink-0 text-gray-400 dark:text-gray-500">
                  &rarr;
                </span>
                <span className="truncate text-green-700 dark:text-green-400">
                  {displayValue(entry.new_value)}
                </span>
              </div>
            </div>
          ))}
      </div>
    </motion.div>
  );
}
