import { useEffect, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { QueueItem } from '../../shared/types';
import { useKaraoke } from './KaraokeContext';
import { VideoRow } from './VideoRow';

function SortableRow({ item, index, onRemove }: { item: QueueItem; index: number; onRemove: (item: QueueItem) => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  return (
    <div
      ref={setNodeRef}
      className={`queue-row${isDragging ? ' dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <VideoRow
        video={item}
        leading={
          <button className="drag-handle" ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label="Drag to reorder">
            <span className="pos">{index + 1}</span>
            <span className="grip">⋮⋮</span>
          </button>
        }
        meta={<span className="singer">added by {item.addedBy}</span>}
        actions={
          <button className="btn small icon danger-ghost" onClick={() => onRemove(item)} aria-label={`Remove ${item.title}`} title="Remove">
            ✕
          </button>
        }
      />
    </div>
  );
}

export function QueueList() {
  const { state, send, notify, role } = useKaraoke();
  const serverQueue = state?.queue ?? [];
  // Local copy so a drag shows the new order instantly; the server's broadcast then confirms it.
  const [items, setItems] = useState<QueueItem[]>(serverQueue);
  useEffect(() => setItems(state?.queue ?? []), [state?.queue]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = items.findIndex((i) => i.id === active.id);
    const to = items.findIndex((i) => i.id === over.id);
    if (from < 0 || to < 0) return;
    setItems(arrayMove(items, from, to));
    const ack = await send({ type: 'queue:move', itemId: String(active.id), toIndex: to });
    if (!ack.ok) {
      notify(ack.error, 'error');
      setItems(state?.queue ?? []);
    }
  }

  async function onRemove(item: QueueItem) {
    const ack = await send({ type: 'queue:remove', itemId: item.id });
    if (!ack.ok) notify(ack.error, 'error');
  }

  async function onClear() {
    const ack = await send({ type: 'queue:clear' });
    if (!ack.ok) notify(ack.error, 'error');
  }

  if (items.length === 0) {
    return (
      <div className="panel">
        <div className="empty">The queue is empty. Search for a song or pick one from a playlist.</div>
      </div>
    );
  }

  return (
    <div className="panel queue-panel">
      <div className="panel-header">
        <span>
          {items.length} song{items.length === 1 ? '' : 's'} up next
        </span>
        {role === 'host' && (
          <ConfirmButton className="btn small ghost" confirmLabel="Clear all?" onConfirm={onClear}>
            Clear
          </ConfirmButton>
        )}
      </div>
      <div className="list-scroll">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
            {items.map((item, i) => (
              <SortableRow key={item.id} item={item} index={i} onRemove={onRemove} />
            ))}
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
}

/** Two-step button: first click arms it for 3 seconds, second click confirms. */
export function ConfirmButton({
  children,
  confirmLabel,
  onConfirm,
  className,
  title,
}: {
  children: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  className?: string;
  title?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      className={`${className ?? ''}${armed ? ' armed' : ''}`}
      title={title}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? confirmLabel : children}
    </button>
  );
}
