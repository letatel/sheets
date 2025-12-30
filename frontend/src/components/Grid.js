import React, { useState, useRef, useEffect, useCallback } from 'react';
import './Grid.css';

const ROWS = 100;
const COLS = 26;

function Grid({
  cells,
  onCellChange,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  remoteCursors = {},
  onCursorMove,
  currentSheet,
  allSheets = []
}) {
  const [selectedCell, setSelectedCell] = useState({ row: 1, column: 1 });
  const [selectionRange, setSelectionRange] = useState(null);
  const [editingCell, setEditingCell] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [formulaBarValue, setFormulaBarValue] = useState('');
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showFormulaMenu, setShowFormulaMenu] = useState(false);
  const [isSelecting, setIsSelecting] = useState(false);
  const [isEditingFromFormulaBar, setIsEditingFromFormulaBar] = useState(false);
  const [columnWidths, setColumnWidths] = useState(() => {
    const widths = {};
    for (let i = 1; i <= COLS; i++) {
      widths[i] = 100;
    }
    return widths;
  });
  const [resizingColumn, setResizingColumn] = useState(null);
  const [resizeStartX, setResizeStartX] = useState(0);
  const [resizeStartWidth, setResizeStartWidth] = useState(0);

  const gridRef = useRef(null);
  const inputRef = useRef(null);
  const formulaBarRef = useRef(null);
  const isClickingCell = useRef(false);
  const editingSheetRef = useRef(null); // Сохраняем лист, на котором началось редактирование
  const editingFromFormulaBarRef = useRef(false);
  const isClickingFormulaBarRef = useRef(false);
  const blurTimeoutRef = useRef(null);
  
  const colors = [
    '#FFFFFF', '#FFEBEE', '#FCE4EC', '#F3E5F5', '#E8EAF6',
    '#E3F2FD', '#E0F2F1', '#E8F5E9', '#FFF9C4', '#FFF3E0',
    '#EFEBE9', '#FAFAFA', '#ECEFF1', '#FFCDD2', '#F8BBD0',
    '#E1BEE7', '#C5CAE9', '#BBDEFB', '#B2DFDB', '#C8E6C9',
    '#DCEDC8', '#F0F4C3', '#FFE0B2', '#D7CCC8', '#CFD8DC',
    '#000000', '#424242', '#757575', '#BDBDBD', '#E0E0E0'
  ];

  const formulas = [
    { name: 'SUM', description: 'Сумма', template: '=SUM(A1:A10)' },
    { name: 'AVERAGE', description: 'Среднее', template: '=AVERAGE(A1:A10)' },
    { name: 'MAX', description: 'Максимум', template: '=MAX(A1:A10)' },
    { name: 'MIN', description: 'Минимум', template: '=MIN(A1:A10)' },
    { name: 'COUNT', description: 'Количество', template: '=COUNT(A1:A10)' },
    { name: 'Сложение', description: 'A1+B1', template: '=A1+B1' },
    { name: 'Вычитание', description: 'A1-B1', template: '=A1-B1' },
    { name: 'Умножение', description: 'A1*B1', template: '=A1*B1' },
    { name: 'Деление', description: 'A1/B1', template: '=A1/B1' },
  ];

  // Синхронизация строки формул
  useEffect(() => {
    if (!editingCell) {
      // Синхронизируем строку формул при изменении выбранной ячейки (только если не редактируем)
      if (selectedCell && !editingFromFormulaBarRef.current) {
        const key = getCellKey(selectedCell.row, selectedCell.column);
        const cell = cells[key];
        const value = cell?.formula || cell?.value || '';
        setFormulaBarValue(value);
        setEditValue(value);
        setIsEditingFromFormulaBar(false);
      }
      return;
    }
    
    // Устанавливаем фокус с небольшой задержкой, чтобы избежать конфликтов
    // Но только если фокус действительно потерян
    const timeoutId = setTimeout(() => {
      if (editingFromFormulaBarRef.current) {
        if (formulaBarRef.current) {
          // Проверяем, что фокус действительно не на строке формул
          const activeElement = document.activeElement;
          if (activeElement !== formulaBarRef.current && 
              !(activeElement?.closest && activeElement.closest('.formula-bar'))) {
            formulaBarRef.current.focus();
            const length = formulaBarRef.current.value.length;
            formulaBarRef.current.setSelectionRange(length, length);
          }
        }
      } else if (inputRef.current && document.activeElement !== inputRef.current) {
        inputRef.current.focus();
      }
    }, 10);
    
    return () => clearTimeout(timeoutId);
  }, [editingCell, selectedCell]);

  // Восстановление фокуса при смене листа
  useEffect(() => {
    if (editingCell && currentSheet && !editingSheetRef.current) {
      editingSheetRef.current = currentSheet;
    }
    // Восстанавливаем фокус на поле ввода при смене листа, если редактирование активно
    if (editingCell && inputRef.current) {
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
        }
      }, 50);
    }
  }, [editingCell, currentSheet]);

  useEffect(() => {
    const handleMouseUp = () => {
      setIsSelecting(false);
      if (resizingColumn !== null) {
        setResizingColumn(null);
      }
    };
    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, [resizingColumn]);

  // Column resize
  useEffect(() => {
    if (resizingColumn === null) return;

    const handleMouseMove = (e) => {
      const diff = e.clientX - resizeStartX;
      const newWidth = Math.max(50, resizeStartWidth + diff);
      setColumnWidths(prev => ({
        ...prev,
        [resizingColumn]: newWidth
      }));
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleMouseMove);
    
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
    };
  }, [resizingColumn, resizeStartX, resizeStartWidth]);

  const handleResizeStart = (column, e) => {
    e.preventDefault();
    e.stopPropagation();
    setResizingColumn(column);
    setResizeStartX(e.clientX);
    setResizeStartWidth(columnWidths[column]);
  };

  const getCellKey = (row, column) => `${row}_${column}`;

  const getCellDisplay = (row, column) => {
    const key = getCellKey(row, column);
    const cell = cells[key];
    if (!cell) return '';
    if (cell.formula) {
      return cell.value?.startsWith('#ОШИБКА') ? cell.value : (cell.value || '');
    }
    return cell.value || '';
  };

  const getCellStyle = (row, column) => {
    const key = getCellKey(row, column);
    const cell = cells[key];
    if (!cell?.style) return {};
    const { backgroundColor, color } = cell.style;
    return { backgroundColor, color };
  };

  const isCellInSelection = (row, column) => {
    if (!selectionRange) return selectedCell.row === row && selectedCell.column === column;
    const { start, end } = selectionRange;
    const minRow = Math.min(start.row, end.row), maxRow = Math.max(start.row, end.row);
    const minCol = Math.min(start.column, end.column), maxCol = Math.max(start.column, end.column);
    return row >= minRow && row <= maxRow && column >= minCol && column <= maxCol;
  };

  const columnToLetter = (col) => {
    let result = '';
    while (col > 0) {
      col--;
      result = String.fromCharCode(65 + (col % 26)) + result;
      col = Math.floor(col / 26);
    }
    return result;
  };

  const getCellReference = (row, column) => `${columnToLetter(column)}${row}`;

  const commitEdit = useCallback((row, column, value) => {
    const trimmed = value.trim();
    if (!trimmed || trimmed === '=') {
      const key = getCellKey(row, column);
      const cell = cells[key];
      onCellChange(row, column, '', '', cell?.style || {});
    } else if (trimmed.startsWith('=')) {
      onCellChange(row, column, '', trimmed);
    } else {
      onCellChange(row, column, trimmed, '');
    }
  }, [cells, onCellChange]);

  const commitEditFromFormulaBar = useCallback(() => {
    if (!editingCell) return;
    const { row, column } = editingCell;
    commitEdit(row, column, formulaBarValue);
    setEditingCell(null);
    setEditValue('');
    setFormulaBarValue('');
    setIsEditingFromFormulaBar(false);
    editingSheetRef.current = null;
  }, [editingCell, formulaBarValue, commitEdit]);

  const handleFormulaSelect = (template) => {
    let formula = template;
    if (selectionRange) {
      const { start, end } = selectionRange;
      const startRef = getCellReference(start.row, start.column);
      const endRef = getCellReference(end.row, end.column);
      formula = formula.replace(/A1:A10/g, `${startRef}:${endRef}`).replace(/A1/g, startRef).replace(/B1/g, endRef);
    } else if (selectedCell) {
      const ref = getCellReference(selectedCell.row, selectedCell.column);
      formula = formula.replace(/A1:A10/g, ref).replace(/A1/g, ref);
      if (selectedCell.column < COLS) {
        const nextRef = getCellReference(selectedCell.row, selectedCell.column + 1);
        formula = formula.replace(/B1/g, nextRef);
      }
    }

    setEditingCell({ row: selectedCell.row, column: selectedCell.column });
    editingSheetRef.current = currentSheet;
    setEditValue(formula);
    setFormulaBarValue(formula);
    setIsEditingFromFormulaBar(false);
    setShowFormulaMenu(false);

    setTimeout(() => {
      inputRef.current?.focus();
      const match = formula.match(/([A-Z]+\d+:[A-Z]+\d+)/);
      if (match && inputRef.current) {
        const start = formula.indexOf(match[1]);
        inputRef.current.setSelectionRange(start, start + match[1].length);
      }
    }, 10);
  };

  const handleColorSelect = (color) => {
    const applyToRange = (minRow, maxRow, minCol, maxCol) => {
      for (let r = minRow; r <= maxRow; r++) {
        for (let c = minCol; c <= maxCol; c++) {
          const key = getCellKey(r, c);
          const cell = cells[key];
          const style = { ...(cell?.style || {}), backgroundColor: color };
          onCellChange(r, c, cell?.value || '', cell?.formula || '', style);
        }
      }
    };

    if (selectionRange) {
      const { start, end } = selectionRange;
      applyToRange(
        Math.min(start.row, end.row), Math.max(start.row, end.row),
        Math.min(start.column, end.column), Math.max(start.column, end.column)
      );
    } else if (selectedCell) {
      const key = getCellKey(selectedCell.row, selectedCell.column);
      const cell = cells[key];
      const style = { ...(cell?.style || {}), backgroundColor: color };
      onCellChange(selectedCell.row, selectedCell.column, cell?.value || '', cell?.formula || '', style);
    }
    setShowColorPicker(false);
  };

  const handleCellMouseDown = (row, column, e) => {
    if (editingCell) {
      e.preventDefault();
      return;
    }
    gridRef.current?.focus();
    if (e.shiftKey && selectedCell) {
      setSelectionRange({ start: selectedCell, end: { row, column } });
    } else {
      setSelectedCell({ row, column });
      setSelectionRange({ start: { row, column }, end: { row, column } });
      setIsSelecting(true);
    }
  };

  const handleCellMouseEnter = (row, column) => {
    if (isSelecting && selectionRange) {
      setSelectionRange({ ...selectionRange, end: { row, column } });
      setSelectedCell({ row, column });
    }
  };

  const handleCellClick = (row, column, e) => {
    // Устанавливаем фокус на контейнер для обработки клавиатуры
    if (gridRef.current && !editingCell) {
      gridRef.current.focus();
    }
    
    // Если мы в режиме редактирования И редактируем не через строку формул, добавляем ссылку на ячейку в формулу
    if (editingCell && !editingFromFormulaBarRef.current) {
      e.preventDefault();
      e.stopPropagation();
      
      // Убеждаемся, что editingSheetRef установлен
      if (!editingSheetRef.current && currentSheet) {
        editingSheetRef.current = currentSheet;
      }
      
      let cellRef = getCellReference(row, column);
      
      // Проверяем, находится ли кликнутая ячейка на другом листе
      // Если редактирование началось на другом листе, добавляем имя текущего листа
      if (editingSheetRef.current && currentSheet) {
        // Если редактирование началось на другом листе, добавляем имя текущего листа
        if (editingSheetRef.current.id !== currentSheet.id) {
          // Ячейка на другом листе - добавляем имя листа
          cellRef = `${currentSheet.name}!${cellRef}`;
        }
        // Если редактирование и клик на одном листе, просто добавляем ссылку без имени листа
      }
      
      // Добавляем ссылку на ячейку в текущее значение формулы
      const currentValue = editValue || '';
      let newValue;
      // Если формула уже начинается с =, просто добавляем ссылку
      if (currentValue.startsWith('=')) {
        newValue = currentValue + cellRef;
      } else {
        // Если нет =, добавляем = и ссылку
        newValue = '=' + cellRef;
      }
      
      setEditValue(newValue);
      setFormulaBarValue(newValue);
      // Обновляем выделение, но остаемся в режиме редактирования
      setSelectedCell({ row, column });
      setSelectionRange(null);
      // Фокусируемся обратно на поле ввода
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          // Перемещаем курсор в конец
          const length = inputRef.current.value.length;
          inputRef.current.setSelectionRange(length, length);
        }
      }, 10);
      return;
    }
    
    // Если редактируем через строку формул и кликаем на ячейку, добавляем ссылку на ячейку в формулу
    if (editingCell && editingFromFormulaBarRef.current) {
      e.preventDefault();
      e.stopPropagation();
      
      // Убеждаемся, что editingSheetRef установлен
      if (!editingSheetRef.current && currentSheet) {
        editingSheetRef.current = currentSheet;
      }
      
      let cellRef = getCellReference(row, column);
      
      // Проверяем, находится ли кликнутая ячейка на другом листе
      if (editingSheetRef.current && currentSheet) {
        if (editingSheetRef.current.id !== currentSheet.id) {
          // Ячейка на другом листе - добавляем имя листа
          cellRef = `${currentSheet.name}!${cellRef}`;
        }
      }
      
      // Получаем текущее значение из строки формул
      const currentValue = formulaBarValue || editValue || '';
      let newValue;
      // Если формула уже начинается с =, просто добавляем ссылку
      if (currentValue.startsWith('=')) {
        newValue = currentValue + cellRef;
      } else {
        // Если нет =, добавляем = и ссылку
        newValue = '=' + cellRef;
      }
      
      setEditValue(newValue);
      setFormulaBarValue(newValue);
      // Обновляем выделение, но остаемся в режиме редактирования
      setSelectedCell({ row, column });
      setSelectionRange(null);
      // Фокусируемся обратно на строку формул
      setTimeout(() => {
        if (formulaBarRef.current) {
          formulaBarRef.current.focus();
          // Перемещаем курсор в конец
          const length = formulaBarRef.current.value.length;
          formulaBarRef.current.setSelectionRange(length, length);
        }
      }, 10);
      return;
    }

    setSelectedCell({ row, column });
    setSelectionRange(null);
  };

  const handleCellDoubleClick = (row, column) => {
    setSelectedCell({ row, column });
    setSelectionRange(null);
    const key = getCellKey(row, column);
    const cell = cells[key];
    const value = cell?.formula || cell?.value || '';
    setEditingCell({ row, column });
    editingSheetRef.current = currentSheet;
    setEditValue(value);
    setIsEditingFromFormulaBar(false);
  };

  const handleInputChange = (e) => setEditValue(e.target.value);

  const handleFormulaBarChange = (e) => {
    const value = e.target.value;
    // При изменении строки формул всегда обновляем editValue
    // и переводим ячейку в режим редактирования, если еще не в нем
    editingFromFormulaBarRef.current = true;
    setIsEditingFromFormulaBar(true);
    setIsEditingFromFormulaBar(true);
    if (!editingCell && selectedCell) {
      setEditingCell({ row: selectedCell.row, column: selectedCell.column });
      editingSheetRef.current = currentSheet;
    }
    setEditValue(value);
    setFormulaBarValue(value);
    // Синхронизируем с input в ячейке
    if (inputRef.current && editingCell) {
      inputRef.current.value = value;
    }
  };

  const handleFormulaBarFocus = (e) => {
    // Предотвращаем всплытие события
    e.stopPropagation();
    
    // При фокусе на строке формул переходим в режим редактирования выбранной ячейки
    editingFromFormulaBarRef.current = true;
    
    if (!editingCell && selectedCell) {
      const key = getCellKey(selectedCell.row, selectedCell.column);
      const cell = cells[key];
      const value = cell?.formula || cell?.value || '';
      setEditingCell({ row: selectedCell.row, column: selectedCell.column });
      editingSheetRef.current = currentSheet;
      setEditValue(value);
      setFormulaBarValue(value);
      
      // Устанавливаем фокус после обновления состояния
      setTimeout(() => {
        if (formulaBarRef.current) {
          formulaBarRef.current.focus();
          const length = formulaBarRef.current.value.length;
          formulaBarRef.current.setSelectionRange(length, length);
        }
      }, 0);
    } else if (editingCell) {
      // Если уже редактируем, синхронизируем значение
      setFormulaBarValue(editValue);
      // Убеждаемся, что фокус остается на строке формул
      setTimeout(() => {
        if (formulaBarRef.current && document.activeElement !== formulaBarRef.current) {
          formulaBarRef.current.focus();
        }
      }, 0);
    }
  };

  const handleFormulaBarBlur = (event) => {
    const e = event || {};
    // Очищаем предыдущий timeout, если он есть
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
    
    // Если кликнули на ячейку, не выходим из режима редактирования
    if (isClickingCell.current) {
      return;
    }
    
    // Если кликнули на строку формул, полностью игнорируем blur
    if (isClickingFormulaBarRef.current) {
      // Восстанавливаем фокус немедленно
      setTimeout(() => {
        if (formulaBarRef.current && document.activeElement !== formulaBarRef.current) {
          formulaBarRef.current.focus();
        }
      }, 0);
      return;
    }
    
    // Если фокус перешел на другой элемент внутри строки формул, не выходим из режима редактирования
    const relatedTarget = e.relatedTarget;
    if (relatedTarget?.closest?.('.formula-bar')) {
      return;
    }
    
    // Если фокус потерян из-за клика на саму строку формул, не выходим
    const target = e.target || formulaBarRef.current;
    if (relatedTarget === formulaBarRef.current || 
        (relatedTarget && relatedTarget === target)) {
      return;
    }
    
    // Откладываем blur, чтобы дать время для обработки кликов
    blurTimeoutRef.current = setTimeout(() => {
      // Проверяем, что фокус действительно потерян и не был восстановлен
      if (document.activeElement !== formulaBarRef.current && !isClickingFormulaBarRef.current) {
        editingFromFormulaBarRef.current = false;
        setIsEditingFromFormulaBar(false);
        
        // Сохраняем значение из строки формул
        if (editingCell) {
          const { row, column } = editingCell;
          const value = (formulaBarRef.current?.value || '').trim();
          
          // Не сохраняем пустую или неполную формулу
          if (value && value !== '=') {
            if (value.startsWith('=')) {
              onCellChange(row, column, '', value);
            } else {
              onCellChange(row, column, value, '');
            }
          }
          
          setEditingCell(null);
          setEditValue('');
          editingSheetRef.current = null;
        }
      }
    }, 200);
  };

  const handleFormulaBarKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitEditFromFormulaBar();
      if (selectedCell.row < ROWS) {
        const newRow = selectedCell.row + 1;
        setSelectedCell({ row: newRow, column: selectedCell.column });
        onCursorMove?.(newRow, selectedCell.column);
      }
      gridRef.current?.focus();
    } else if (e.key === 'Escape') {
      setEditingCell(null);
      setEditValue('');
      setFormulaBarValue('');
      setIsEditingFromFormulaBar(false);
      editingSheetRef.current = null;
      gridRef.current?.focusFocus();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      commitEditFromFormulaBar();
      if (selectedCell.column < COLS) {
        setSelectedCell({ row: selectedCell.row, column: selectedCell.column + 1 });
      }
      gridRef.current?.focus();
    }
  };

  const handleInputBlur = () => {
    if (editingCell) {
      commitEdit(editingCell.row, editingCell.column, editValue);
      setEditingCell(null);
      setEditValue('');
      setIsEditingFromFormulaBar(false);
      editingSheetRef.current = null;
    }
  };

  const handleInputKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleInputBlur();
      if (selectedCell.row < ROWS) {
        setSelectedCell({ row: selectedCell.row + 1, column: selectedCell.column });
      }
    } else if (e.key === 'Escape') {
      setEditingCell(null);
      setEditValue('');
      editingSheetRef.current = null;
    } else if (e.key === 'Tab') {
      e.preventDefault();
      handleInputBlur();
      if (selectedCell.column < COLS) {
        setSelectedCell({ row: selectedCell.row, column: selectedCell.column + 1 });
      }
    }
  };

  const handleKeyDown = (e) => {
    if (document.activeElement === formulaBarRef.current) return;

    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z' && canUndo) {
      e.preventDefault(); onUndo(); return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z')) && canRedo) {
      e.preventDefault(); onRedo(); return;
    }

    if (editingCell) return;

    if (['Delete', 'Backspace'].includes(e.key)) {
      e.preventDefault();
      const applyClear = (minRow, maxRow, minCol, maxCol) => {
        for (let r = minRow; r <= maxRow; r++) {
          for (let c = minCol; c <= maxCol; c++) {
            const key = getCellKey(r, c);
            const cell = cells[key];
            onCellChange(r, c, '', '', cell?.style || {});
          }
        }
      };
      if (selectionRange) {
        const { start, end } = selectionRange;
        applyClear(
          Math.min(start.row, end.row), Math.max(start.row, end.row),
          Math.min(start.column, end.column), Math.max(start.column, end.column)
        );
      } else if (selectedCell) {
        const key = getCellKey(selectedCell.row, selectedCell.column);
        const cell = cells[key];
        onCellChange(selectedCell.row, selectedCell.column, '', '', cell?.style || {});
      }
      return;
    }

    let newRow = selectedCell.row, newCol = selectedCell.column;
    if (e.key === 'ArrowUp' && newRow > 1) newRow--;
    else if (e.key === 'ArrowDown' && newRow < ROWS) newRow++;
    else if (e.key === 'ArrowLeft' && newCol > 1) newCol--;
    else if (e.key === 'ArrowRight' && newCol < COLS) newCol++;
    else if (e.key === 'Enter') {
      e.preventDefault();
      const key = getCellKey(selectedCell.row, selectedCell.column);
      const cell = cells[key];
      setEditingCell({ row: selectedCell.row, column: selectedCell.column });
      editingSheetRef.current = currentSheet;
      setEditValue(cell?.formula || cell?.value || '');
      setIsEditingFromFormulaBar(false);
      return;
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      setEditingCell({ row: selectedCell.row, column: selectedCell.column });
      editingSheetRef.current = currentSheet;
      setEditValue(e.key);
      setIsEditingFromFormulaBar(false);
      return;
    } else return;

    e.preventDefault();
    setSelectedCell({ row: newRow, column: newCol });
    onCursorMove?.(newRow, newCol);
  };

  return (
    <div className="grid-wrapper-container">
      {/* Toolbar */}
      <div className="toolbar">
        <button className={`toolbar-btn ${!canUndo ? 'disabled' : ''}`} onClick={onUndo} disabled={!canUndo} title="Отменить (Ctrl+Z)">
          ↶ Отменить
        </button>
        <button className={`toolbar-btn ${!canRedo ? 'disabled' : ''}`} onClick={onRedo} disabled={!canRedo} title="Повторить (Ctrl+Y)">
          ↷ Повторить
        </button>
        <div className="toolbar-separator" />

        <div className="dropdown">
          <button className="toolbar-btn" onClick={() => { setShowFormulaMenu(!showFormulaMenu); setShowColorPicker(false); }}>
            ƒ Формулы
          </button>
          {showFormulaMenu && (
            <div ref={formulaMenuRef} className="formula-menu" onClick={e => e.stopPropagation()}>
              <div className="formula-menu-header">Выберите формулу</div>
              <div className="formula-list">
                {formulas.map((f, i) => (
                  <div key={i} className="formula-item" onClick={() => handleFormulaSelect(f.template)} title={f.template}>
                    <div className="formula-name">{f.name}</div>
                    <div className="formula-desc">{f.description}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="dropdown">
          <button className="toolbar-btn" onClick={() => { setShowColorPicker(!showColorPicker); setShowFormulaMenu(false); }}>
            Цвет
          </button>
          {showColorPicker && (
            <div ref={colorPickerRef} className="color-picker" onClick={e => e.stopPropagation()}>
              <div className="color-picker-grid">
                {colors.map((c, i) => (
                  <div key={i} className="color-item" style={{ backgroundColor: c }} onClick={() => handleColorSelect(c)} title={c} />
                ))}
              </div>
              <button className="color-remove-btn" onClick={() => handleColorSelect('#FFFFFF')}>
                Убрать цвет
              </button>
            </div>
          )}
        </div>
      </div>
      
      {/* Строка формул */}
      <div className="formula-bar">
        <div className="formula-bar-label">
          {editingCell && editingSheetRef.current && editingSheetRef.current.id !== currentSheet?.id 
            ? `${editingSheetRef.current.name}!${selectedCell ? getCellReference(selectedCell.row, selectedCell.column) : ''}`
            : (selectedCell ? getCellReference(selectedCell.row, selectedCell.column) : '')}
        </div>
        <div className="formula-bar-separator" />
        <input
          ref={formulaBarRef}
          type="text"
          className="formula-bar-input"
          placeholder="Введите формулу или значение"
          value={editingCell ? (isEditingFromFormulaBar ? formulaBarValue : editValue) : (() => {
            if (!selectedCell) return '';
            const key = getCellKey(selectedCell.row, selectedCell.column);
            const cell = cells[key];
            return cell?.formula || cell?.value || '';
          })()}
          onChange={handleFormulaBarChange}
          onFocus={handleFormulaBarFocus}
          onKeyDown={handleFormulaBarKeyDown}
        />
      </div>

      {/* Grid */}
      <div
        className="grid-container"
        ref={gridRef}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        onClick={() => { setShowColorPicker(false); setShowFormulaMenu(false); }}
      >
        <div className="grid-wrapper">
          <div className="grid-header">
            <div className="header-corner" />
            {Array.from({ length: COLS }, (_, i) => {
              const col = i + 1;
              return (
                <div key={i} className="header-cell-wrapper" style={{ width: columnWidths[col] }}>
                  <div className="header-cell">{columnToLetter(col)}</div>
                  <div
                    className="header-resize-handle"
                    onMouseDown={(e) => handleResizeStart(col, e)}
                  />
                </div>
              );
            })}
          </div>

          {Array.from({ length: ROWS }, (_, ri) => {
            const row = ri + 1;
            return (
              <div key={row} className="grid-row">
                <div className="row-header">{row}</div>
                {Array.from({ length: COLS }, (_, ci) => {
                  const col = ci + 1;
                  const isEditing = editingCell?.row === row && editingCell?.column === col;
                  const showInput = isEditing && !isEditingFromFormulaBar;
                  const displayValue = isEditing
                    ? (isEditingFromFormulaBar ? formulaBarValue : editValue)
                    : getCellDisplay(row, col);

                  return (
                    <div
                      key={col}
                      className={`cell ${isCellInSelection(row, col) ? 'selected' : ''}`}
                      style={{ ...getCellStyle(row, col), width: columnWidths[col] }}
                      onMouseDown={e => handleCellMouseDown(row, col, e)}
                      onMouseEnter={() => handleCellMouseEnter(row, col)}
                      onClick={e => { e.stopPropagation(); handleCellClick(row, col, e); }}
                      onDoubleClick={() => handleCellDoubleClick(row, col)}
                    >
                      {showInput ? (
                        <input
                          ref={inputRef}
                          type="text"
                          className="cell-input"
                          value={editValue}
                          onChange={handleInputChange}
                          onBlur={handleInputBlur}
                          onKeyDown={handleInputKeyDown}
                          autoFocus
                        />
                      ) : (
                        <span className="cell-content">{displayValue}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default Grid;