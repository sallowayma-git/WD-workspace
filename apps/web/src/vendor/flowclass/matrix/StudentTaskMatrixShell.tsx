/**
 * Source: Flowclass
 * Original path:
 * apps/admin/src/pages/AttendanceSheet/index.tsx
 * Snapshot: flowclass local snapshot manifest sha256 cb4f93dc625794842c536f34a63d712298c6a92d8ac2133705945cd31d1ebcb2
 * Source SHA-256: 874699e97940cbaca342e49948b014c93ddf3b7be7255c8106d04aec904d37ef
 * Decision: ADAPT
 * Adaptations:
 * - only the matrix shell is taken: sticky first column + horizontal scroll
 * - kept WD's TanStack Virtual rows, Ant Design table header and TaskCard closures
 * - removed attendance status, course/class selectors and attendance summary
 * - WD 2026-08-30: responsive width — when the container is wider than the
 *   declared column widths, the surplus is distributed proportionally to the
 *   non-fixed (date) columns so the matrix fills the viewport; header colgroup
 *   and the virtual body share the same adjusted widths and stay aligned.
 * - WD 2026-09-19: rows use TanStack Virtual measurement and support multiple
 *   cumulative fixed-left columns in the virtual body.
 */
import { Table, type TableColumnsType } from "antd";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

interface MatrixRow {
  id: string;
}

export interface StudentTaskMatrixShellProps<TRow extends MatrixRow> {
  columns: TableColumnsType<TRow>;
  data: TRow[];
  /** Initial estimate used by the virtualizer before a row is measured. */
  estimatedRowHeight?: number;
  /** Height of the scroll viewport. */
  viewportHeight?: number;
  /** @deprecated source-compatible alias for older consumers. */
  rowHeight?: number;
  /** @deprecated source-compatible alias for older consumers. */
  viewportRows?: number;
  /** Column keys whose widths came from an explicit user setting. */
  manualColumnKeys?: ReadonlySet<string> | readonly string[];
  /** Called after a header resize, clamped to 100–600px. */
  onColumnResize?: (key: string, width: number) => void;
  /** Reports the responsive widths used by both the header and virtual body. */
  onColumnWidthsChange?: (widths: number[]) => void;
}

/**
 * Matrix structure adapted from Flowclass AttendanceSheet while retaining
 * WD's TanStack Virtual rows, Ant Design header and TaskCard render closures.
 */
export function StudentTaskMatrixShell<TRow extends MatrixRow>({
  columns,
  data,
  estimatedRowHeight: estimatedRowHeightProp,
  viewportHeight: viewportHeightProp,
  rowHeight,
  viewportRows,
  manualColumnKeys,
  onColumnResize,
  onColumnWidthsChange,
}: StudentTaskMatrixShellProps<TRow>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const estimatedRowHeight = estimatedRowHeightProp ?? rowHeight ?? 96;
  const viewportHeight =
    viewportHeightProp ??
    (rowHeight ?? estimatedRowHeight) * (viewportRows ?? 6);
  const explicitColumnKeys = useMemo(() => {
    if (manualColumnKeys instanceof Set) return manualColumnKeys;
    return new Set(manualColumnKeys ?? []);
  }, [manualColumnKeys]);

  // 响应式宽度：容器比列宽之和建议值更宽时，把多出的宽度按比例分给
  // 非固定列（日期列），fixed: "left" 的学生列保持原宽。表头 colgroup
  // 与虚拟化 body 使用同一套调整后的列宽，铺满的同时逐列对齐。
  const [containerWidth, setContainerWidth] = useState(0);
  useEffect(() => {
    const element = shellRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setContainerWidth(Math.round(width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const { adjustedColumns, adjustedTotalWidth } = useMemo(() => {
    const widths = columns.map((column) =>
      typeof column.width === "number" ? column.width : 0,
    );
    const declaredTotal = widths.reduce((sum, width) => sum + width, 0);
    const extra = Math.max(0, containerWidth - declaredTotal);
    const flexIndexes = columns
      .map((column, index) => {
        const key = String(column.key ?? index);
        return column.fixed === "left" ||
          column.fixed === true ||
          explicitColumnKeys.has(key)
          ? -1
          : index;
      })
      .filter((index) => index >= 0);
    const flexDeclared = flexIndexes.reduce(
      (sum, index) => sum + widths[index],
      0,
    );
    let distributed = 0;
    flexIndexes.forEach((index, position) => {
      const share =
        flexDeclared > 0
          ? widths[index] / flexDeclared
          : 1 / Math.max(1, flexIndexes.length);
      // 最后一列吃掉取整余数，保证总宽恰好铺满容器。
      const gain =
        position === flexIndexes.length - 1
          ? extra - distributed
          : Math.floor(extra * share);
      distributed += gain;
      widths[index] += gain;
    });
    return {
      adjustedColumns: columns.map((column, index) => ({
        ...column,
        width: widths[index],
      })),
      adjustedTotalWidth: declaredTotal + extra,
    };
  }, [columns, containerWidth, explicitColumnKeys]);

  const adjustedWidths = useMemo(
    () =>
      adjustedColumns.map((column) =>
        typeof column.width === "number" ? column.width : 0,
      ),
    [adjustedColumns],
  );
  useEffect(() => {
    onColumnWidthsChange?.(adjustedWidths);
  }, [adjustedWidths, onColumnWidthsChange]);

  const fixedLeftOffsets = useMemo(() => {
    let offset = 0;
    return adjustedColumns.map((column) => {
      const isFixedLeft = column.fixed === "left" || column.fixed === true;
      if (!isFixedLeft) return null;
      const current = offset;
      offset += typeof column.width === "number" ? column.width : 0;
      return current;
    });
  }, [adjustedColumns]);
  const lastFixedLeftIndex = fixedLeftOffsets.reduce(
    (last, offset, index) => (offset == null ? last : index),
    -1,
  );

  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: data.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimatedRowHeight,
    overscan: 4,
    initialRect: { width: adjustedTotalWidth, height: viewportHeight },
  });
  const items = virtualizer.getVirtualItems();

  const renderCell = (row: TRow, rowIndex: number, colIndex: number) => {
    const column = adjustedColumns[colIndex];
    if (!column) return null;
    const render = column.render as
      ((value: unknown, record: TRow, index: number) => ReactNode) | undefined;
    const content = render ? render(undefined, row, rowIndex) : null;
    const isFixedLeft = column.fixed === "left" || column.fixed === true;
    const width = typeof column.width === "number" ? column.width : undefined;

    return (
      <div
        key={column.key ?? colIndex}
        className={
          isFixedLeft ? "ant-table-cell ant-table-cell-fix-left" : undefined
        }
        style={{
          width,
          minWidth: width,
          maxWidth: width,
          borderRight: isFixedLeft
            ? undefined
            : "1px solid var(--ant-color-border-secondary, #f0f0f0)",
          ...(isFixedLeft
            ? {
                position: "sticky",
                left: fixedLeftOffsets[colIndex] ?? 0,
                zIndex: 2,
                background: "var(--ant-color-bg-container, #fff)",
                boxShadow:
                  colIndex === lastFixedLeftIndex
                    ? "6px 0 6px -4px rgba(0,0,0,0.08)"
                    : undefined,
              }
            : {}),
        }}
      >
        {content}
      </div>
    );
  };

  const renderBody = (
    rows: readonly TRow[],
    bodyInfo: {
      ref: unknown;
      onScroll: (info: {
        currentTarget?: HTMLElement;
        scrollLeft?: number;
      }) => void;
    },
  ) => (
    <div
      ref={(element) => {
        scrollRef.current = element;
        assignRef(bodyInfo.ref, element);
      }}
      className="flowclass-matrix-viewport"
      style={{ height: viewportHeight }}
      onScroll={(event) =>
        bodyInfo.onScroll({
          currentTarget: event.currentTarget,
          scrollLeft: event.currentTarget.scrollLeft,
        })
      }
    >
      <div
        data-testid="student-task-matrix-spacer"
        style={{
          height: virtualizer.getTotalSize(),
          minWidth: adjustedTotalWidth,
          position: "relative",
        }}
      >
        {items.map((virtualRow) => {
          const row = rows[virtualRow.index];
          if (!row) return null;
          return (
            <div
              key={row.id}
              data-row-key={row.id}
              data-index={virtualRow.index}
              className="ant-table-row"
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                display: "flex",
                width: "100%",
                minWidth: adjustedTotalWidth,
                // No fixed row height: the row's content determines its
                // measured size and the virtualizer adjusts following rows.
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {adjustedColumns.map((_column, colIndex) =>
                renderCell(row, virtualRow.index, colIndex),
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  const columnsWithResizableHeaders = useMemo(
    () =>
      adjustedColumns.map((column, index) => {
        const key = String(column.key ?? index);
        const originalOnHeaderCell = column.onHeaderCell as
          ((record: unknown) => Record<string, unknown>) | undefined;
        return {
          ...column,
          onHeaderCell: (record: unknown) => ({
            ...(originalOnHeaderCell?.(record) ?? {}),
            onResize: (width: number) => onColumnResize?.(key, width),
            "data-column-key": key,
          }),
        };
      }) as TableColumnsType<TRow>,
    [adjustedColumns, onColumnResize],
  );

  return (
    <div
      ref={shellRef}
      className="flowclass-matrix-shell"
      data-testid="student-task-matrix"
    >
      <Table<TRow>
        rowKey="id"
        dataSource={data}
        pagination={false}
        scroll={{ x: adjustedTotalWidth, y: viewportHeight }}
        columns={columnsWithResizableHeaders}
        components={{
          body: renderBody,
          header: { cell: ResizableHeaderCell },
        }}
      />
    </div>
  );
}

type ResizableHeaderCellProps = HTMLAttributes<HTMLTableCellElement> & {
  onResize?: (width: number) => void;
};

function ResizableHeaderCell({
  children,
  onResize,
  style,
  ...props
}: ResizableHeaderCellProps) {
  const width = typeof style?.width === "number" ? style.width : undefined;
  const startWidthRef = useRef(width ?? 160);
  const startXRef = useRef(0);
  const activeRef = useRef(false);

  const onPointerDown = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (!onResize) return;
    event.preventDefault();
    event.stopPropagation();
    const parent = event.currentTarget.parentElement?.parentElement;
    startWidthRef.current =
      width ?? parent?.getBoundingClientRect().width ?? 160;
    startXRef.current = event.clientX;
    activeRef.current = true;
    const handleMove = (moveEvent: PointerEvent) => {
      if (!activeRef.current) return;
      const next = Math.min(
        600,
        Math.max(
          100,
          startWidthRef.current + moveEvent.clientX - startXRef.current,
        ),
      );
      onResize(next);
    };
    const handleUp = () => {
      activeRef.current = false;
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, { once: true });
  };

  return (
    <th {...props} style={style}>
      <div style={{ position: "relative", width: "100%" }}>
        {children}
        {onResize ? (
          <span
            aria-label="调整列宽"
            role="separator"
            onPointerDown={onPointerDown}
            style={{
              position: "absolute",
              top: 0,
              right: -4,
              width: 8,
              height: "100%",
              cursor: "col-resize",
              touchAction: "none",
              zIndex: 5,
            }}
          />
        ) : null}
      </div>
    </th>
  );
}

function assignRef(ref: unknown, element: HTMLDivElement | null) {
  if (typeof ref === "function") {
    (ref as (value: HTMLDivElement | null) => void)(element);
    return;
  }
  if (ref && typeof ref === "object" && "current" in ref) {
    ref.current = element;
  }
}
