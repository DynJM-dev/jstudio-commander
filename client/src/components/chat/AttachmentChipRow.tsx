import { X, FileText, Image as ImageIcon } from 'lucide-react';
import type { StagedFile } from '../../hooks/useAttachments';
import { isImage } from '../../hooks/useAttachments';

const M = 'Montserrat, sans-serif';

interface Props {
  files: StagedFile[];
  onRemove: (id: string) => void;
  isUploading?: boolean;
}

// Phase S — horizontal row of chips above the chat input. One chip
// per staged file. Image chips show a thumbnail from the object URL;
// other files show a generic icon. Size is rendered in KB/MB.

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

export const AttachmentChipRow = ({ files, onRemove, isUploading = false }: Props) => {
  if (files.length === 0) return null;

  return (
    <div
      className="flex flex-wrap gap-1.5 mb-2"
      style={{ fontFamily: M }}
      data-testid="attachment-chip-row"
    >
      {files.map((s) => {
        const image = isImage(s.file.type);
        return (
          <div
            key={s.id}
            className="flex items-center gap-2 rounded-lg pl-1.5 pr-2 py-1 transition-opacity"
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              opacity: isUploading ? 0.6 : 1,
            }}
            data-testid={`attachment-chip-${s.id}`}
          >
            {image && s.previewUrl ? (
              <img
                src={s.previewUrl}
                alt={s.file.name}
                className="rounded object-cover"
                style={{ width: 28, height: 28 }}
              />
            ) : (
              <div
                className="flex items-center justify-center rounded"
                style={{
                  width: 28,
                  height: 28,
                  background: 'rgba(255, 255, 255, 0.04)',
                  color: 'var(--color-text-secondary)',
                }}
              >
                {image
                  ? <ImageIcon size={14} />
                  : <FileText size={14} />}
              </div>
            )}
            <div className="flex flex-col min-w-0">
              <span
                className="text-xs truncate max-w-[140px]"
                style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}
                title={s.file.name}
              >
                {s.file.name}
              </span>
              <span
                className="text-[10px]"
                style={{ color: 'var(--color-text-tertiary)' }}
              >
                {formatSize(s.file.size)}
              </span>
            </div>
            <button
              onClick={() => onRemove(s.id)}
              disabled={isUploading}
              className="flex items-center justify-center rounded transition-colors"
              style={{
                width: 20,
                height: 20,
                color: 'var(--color-text-tertiary)',
                cursor: isUploading ? 'not-allowed' : 'pointer',
              }}
              onMouseEnter={(e) => {
                if (!isUploading) e.currentTarget.style.color = 'var(--color-error)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--color-text-tertiary)';
              }}
              aria-label={`Remove ${s.file.name}`}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
};
