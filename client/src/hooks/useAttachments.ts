import { useCallback, useRef, useState } from 'react';
import { api } from '../services/api';

// Phase S — chat attachments state.
//
// Owns the staged-files list, the drag state for the input overlay,
// and the upload + @-reference emission on send. The hook is pure
// state + handlers; the visual UI (chips, drop overlay) lives in its
// consumers. Keeping it isolated means ChatPage doesn't need to grow
// another ~150 lines and the pure-state logic is testable without a
// DOM.

// Per-file caps mirror the server (upload.routes.ts). Enforcing here
// stops us from wasting bandwidth on uploads the server will reject
// anyway and lets the UI show a clear "too large" error before the
// POST round-trip.
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const FILE_MAX_BYTES = 10 * 1024 * 1024;
export const MAX_FILES = 5;

// Accepted mime types — same allowlist as the server. Anything else
// is rejected at stage-time with a toast.
export const ACCEPTED_MIME = new Set<string>([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'application/json',
  'application/x-yaml',
  'text/yaml',
  'text/x-yaml',
  'text/csv',
  'text/javascript',
  'application/javascript',
  'application/typescript',
  'text/typescript',
  'text/x-python',
  'application/x-python',
  'text/x-rust',
  'text/x-go',
  'text/html',
  'text/css',
  'text/x-sh',
  'application/x-sh',
]);

export const isImage = (mime: string): boolean => mime.startsWith('image/');

// Stage-time validation shared with tests. Returns the first rejection
// reason (or null when the file is acceptable). The same predicate
// runs in the hook below — exporting it lets tests exercise every
// branch without mocking fetch.
export const validateStagedFile = (file: { type: string; size: number }): string | null => {
  if (!ACCEPTED_MIME.has(file.type)) {
    return `Unsupported type: ${file.type || 'unknown'}`;
  }
  const limit = isImage(file.type) ? IMAGE_MAX_BYTES : FILE_MAX_BYTES;
  if (file.size > limit) {
    return `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB, max ${limit / 1024 / 1024} MB)`;
  }
  return null;
};

export interface StagedFile {
  id: string;
  file: File;
  previewUrl: string | null;
}

// Build the message payload Claude sees in its pane. Space-joined
// on one line — Claude's `@file` resolution treats inline refs and
// line-separated refs identically, and single-line avoids tmux
// bracketed-paste complexity (send-keys + Enter ends the message
// before multi-line prose can make it through).
export const buildInjectedPayload = (paths: string[], message: string): string => {
  const refs = paths.map((p) => `@${p}`).join(' ');
  if (!refs) return message.trim();
  if (!message.trim()) return refs;
  return `${refs} ${message.trim()}`;
};

interface UseAttachmentsResult {
  stagedFiles: StagedFile[];
  isDragging: boolean;
  isUploading: boolean;
  stageError: string | null;
  stageFiles: (files: FileList | File[]) => number;
  removeFile: (id: string) => void;
  clearAll: () => void;
  uploadAndBuildPayload: (sessionId: string, message: string) => Promise<string>;
  dropHandlers: {
    onDragOver: (e: React.DragEvent) => void;
    onDragEnter: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  };
  onPaste: (e: React.ClipboardEvent) => void;
  clearError: () => void;
}

interface UploadResponse {
  files: Array<{ name: string; path: string; size: number; mimeType: string }>;
}

export const useAttachments = (): UseAttachmentsResult => {
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [stageError, setStageError] = useState<string | null>(null);
  const dragCounterRef = useRef(0);

  const stageFiles = useCallback((input: FileList | File[]): number => {
    const files = Array.from(input);
    let accepted = 0;
    let firstError: string | null = null;

    setStagedFiles((prev) => {
      const next = [...prev];
      for (const file of files) {
        if (next.length >= MAX_FILES) {
          if (!firstError) firstError = `Max ${MAX_FILES} files per message`;
          break;
        }
        const err = validateStagedFile(file);
        if (err) {
          if (!firstError) firstError = err;
          continue;
        }
        const previewUrl = isImage(file.type)
          ? URL.createObjectURL(file)
          : null;
        next.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          file,
          previewUrl,
        });
        accepted += 1;
      }
      return next;
    });

    if (firstError) setStageError(firstError);
    else setStageError(null);
    return accepted;
  }, []);

  const removeFile = useCallback((id: string) => {
    setStagedFiles((prev) => {
      const target = prev.find((s) => s.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((s) => s.id !== id);
    });
  }, []);

  const clearAll = useCallback(() => {
    setStagedFiles((prev) => {
      for (const s of prev) {
        if (s.previewUrl) URL.revokeObjectURL(s.previewUrl);
      }
      return [];
    });
    setStageError(null);
  }, []);

  const uploadAndBuildPayload = useCallback(
    async (sessionId: string, message: string): Promise<string> => {
      if (stagedFiles.length === 0) return message.trim();
      setIsUploading(true);
      try {
        const files = stagedFiles.map((s) => s.file);
        const resp = await api.upload<UploadResponse>(`/upload/${sessionId}`, files);
        const paths = resp.files.map((f) => f.path);
        return buildInjectedPayload(paths, message);
      } finally {
        setIsUploading(false);
      }
    },
    [stagedFiles],
  );

  // Drag counter — `dragenter` and `dragleave` fire for every child
  // element the pointer crosses, so a naive boolean flickers wildly.
  // Tracking a counter gives us a single boolean that's true only
  // while the pointer is actually over the drop zone.
  const dropHandlers = {
    onDragOver: (e: React.DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    onDragEnter: (e: React.DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      dragCounterRef.current += 1;
      if (dragCounterRef.current === 1) setIsDragging(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
      if (dragCounterRef.current === 0) setIsDragging(false);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      dragCounterRef.current = 0;
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) {
        stageFiles(e.dataTransfer.files);
      }
    },
  };

  const onPaste = useCallback(
    (e: React.ClipboardEvent) => {
      // Only intercept when the clipboard actually carries files —
      // otherwise let the native text paste behavior proceed into
      // the textarea.
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length === 0) return;
      e.preventDefault();
      stageFiles(files);
    },
    [stageFiles],
  );

  const clearError = useCallback(() => setStageError(null), []);

  return {
    stagedFiles,
    isDragging,
    isUploading,
    stageError,
    stageFiles,
    removeFile,
    clearAll,
    uploadAndBuildPayload,
    dropHandlers,
    onPaste,
    clearError,
  };
};

// `DataTransfer.types` contains the string 'Files' when the drag
// payload is one or more files. We gate on this so the overlay
// doesn't appear when the user is dragging text or a DOM element.
const hasFiles = (dataTransfer: DataTransfer | null): boolean => {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.types).includes('Files');
};
