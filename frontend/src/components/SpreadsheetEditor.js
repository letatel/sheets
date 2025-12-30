import React, { useState, useEffect, useCallback, useRef } from 'react';
import './SpreadsheetEditor.css';
import SheetTabs from './SheetTabs';
import Grid from './Grid';
import ShareDialog from './ShareDialog';
import api from '../services/api';
import wsService from '../services/websocket';

function SpreadsheetEditor({ spreadsheet, onUpdate, onShareClick }) {
  const [sheets, setSheets] = useState([]);
  const [currentSheet, setCurrentSheet] = useState(null);
  const [cells, setCells] = useState({});
  const [loading, setLoading] = useState(true);
  const [spreadsheetName, setSpreadsheetName] = useState(spreadsheet?.name || '');
  
  // История изменений для Undo/Redo
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const historyRef = useRef({ history: [], index: -1 });
  const currentSheetIdRef = useRef(null);
  
  // Активные пользователи
  const [activeUsers, setActiveUsers] = useState([]);
  const [remoteCursors, setRemoteCursors] = useState({});
  const [showShareDialog, setShowShareDialog] = useState(false);
  
  // Передаем функцию открытия диалога в родительский компонент
  useEffect(() => {
    if (onShareClick) {
      onShareClick(() => {
        setShowShareDialog(true);
      });
    }
    // Очищаем функцию при размонтировании
    return () => {
      if (onShareClick) {
        onShareClick(null);
      }
    };
  }, [onShareClick]);

  const loadSheets = useCallback(async () => {
    if (!spreadsheet) return;
    
    try {
      const data = await api.getSheets(spreadsheet.id);
      // Обрабатываем случай, если API возвращает объект с пагинацией
      const sheetsList = Array.isArray(data) ? data : (data.results || []);
      setSheets(sheetsList);
      if (sheetsList.length > 0) {
        setCurrentSheet(sheetsList[0]);
      }
    } catch (error) {
      console.error('Ошибка загрузки листов:', error);
      setSheets([]);
    } finally {
      setLoading(false);
    }
  }, [spreadsheet]);

  const saveToHistory = useCallback((cellsState) => {
    const snapshot = JSON.parse(JSON.stringify(cellsState));
    const newHistory = historyRef.current.history.slice(0, historyRef.current.index + 1);
    newHistory.push(snapshot);
    
    // Ограничиваем историю 50 состояниями
    if (newHistory.length > 50) {
      newHistory.shift();
    } else {
      historyRef.current.index++;
    }
    
    historyRef.current.history = newHistory;
    setHistory(newHistory);
    setHistoryIndex(historyRef.current.index);
  }, []);

  const undo = useCallback(() => {
    if (historyRef.current.index > 0) {
      historyRef.current.index--;
      const previousState = historyRef.current.history[historyRef.current.index];
      setCells(JSON.parse(JSON.stringify(previousState)));
      setHistoryIndex(historyRef.current.index);
      
      // Обновляем ячейки на сервере
      if (currentSheet) {
        Object.values(previousState).forEach(cell => {
          api.updateCell(currentSheet.id, cell.row, cell.column, {
            value: cell.value,
            formula: cell.formula,
            style: cell.style || {}
          }).catch(err => console.error('Ошибка отмены:', err));
        });
      }
    }
  }, [currentSheet]);

  const redo = useCallback(() => {
    if (historyRef.current.index < historyRef.current.history.length - 1) {
      historyRef.current.index++;
      const nextState = historyRef.current.history[historyRef.current.index];
      setCells(JSON.parse(JSON.stringify(nextState)));
      setHistoryIndex(historyRef.current.index);
      
      // Обновляем ячейки на сервере
      if (currentSheet) {
        Object.values(nextState).forEach(cell => {
          api.updateCell(currentSheet.id, cell.row, cell.column, {
            value: cell.value,
            formula: cell.formula,
            style: cell.style || {}
          }).catch(err => console.error('Ошибка повтора:', err));
        });
      }
    }
  }, [currentSheet]);

  const loadCells = useCallback(async (sheetId = null) => {
    // Используем переданный sheetId или текущий currentSheet
    const targetSheetId = sheetId || currentSheet?.id;
    if (!targetSheetId) return;
    
    try {
      const data = await api.getCells(targetSheetId);
      // Обрабатываем случай, если API возвращает объект с пагинацией
      const cellsList = Array.isArray(data) ? data : (data.results || []);
      const cellsMap = {};
      cellsList.forEach(cell => {
        const key = `${cell.row}_${cell.column}`;
        cellsMap[key] = cell;
      });
      setCells(cellsMap);
      
      // Сохраняем начальное состояние в историю (только если не редактируем)
      // Во время редактирования не сохраняем в историю, чтобы не потерять состояние редактирования
      saveToHistory(cellsMap);
    } catch (error) {
      console.error('Ошибка загрузки ячеек:', error);
      setCells({});
    }
  }, [currentSheet, saveToHistory]);

  useEffect(() => {
    if (spreadsheet) {
      setSpreadsheetName(spreadsheet.name);
      loadSheets();
    }
  }, [spreadsheet, loadSheets]);

  useEffect(() => {
    if (currentSheet) {
      // Сохраняем текущий sheetId в ref для проверки в асинхронном коде
      currentSheetIdRef.current = currentSheet.id;
      
      // ВСЕГДА загружаем ячейки нового листа при переключении, даже во время редактирования
      // Используем явный sheetId, чтобы гарантировать загрузку правильного листа
      // Сначала очищаем старые ячейки, чтобы не показывать данные предыдущего листа
      setCells({});
      
      // Загружаем ячейки нового листа напрямую, без использования loadCells callback
      // Это гарантирует, что мы всегда используем актуальный currentSheet.id
      const sheetId = currentSheet.id;
      api.getCells(sheetId)
        .then(data => {
          const cellsList = Array.isArray(data) ? data : (data.results || []);
          const cellsMap = {};
          cellsList.forEach(cell => {
            const key = `${cell.row}_${cell.column}`;
            cellsMap[key] = cell;
          });
          // Проверяем, что лист не изменился во время загрузки
          setCells(prevCells => {
            // Если currentSheet изменился, не обновляем ячейки
            if (currentSheetIdRef.current !== sheetId) {
              return prevCells;
            }
            return cellsMap;
          });
        })
        .catch(error => {
          console.error('Ошибка загрузки ячеек:', error);
          // Проверяем, что лист не изменился перед очисткой
          if (currentSheetIdRef.current === sheetId) {
            setCells({});
          }
        });
      
      // Сбрасываем историю при смене листа (только если не редактируем)
      // Во время редактирования не сбрасываем историю, чтобы не потерять состояние редактирования
      // TODO: можно добавить проверку через ref из Grid, но пока просто не сбрасываем
      // historyRef.current = { history: [], index: -1 };
      // setHistory([]);
      // setHistoryIndex(-1);
    }
  }, [currentSheet?.id]);

  // WebSocket подключение
  useEffect(() => {
    if (!spreadsheet || !currentSheet) return;

    const token = api.getAuthToken();
    if (!token) return;

    // Подключаемся к WebSocket
    wsService.connect(spreadsheet.id, token);

    // Обработчики событий WebSocket
    const handleCellUpdate = (data) => {
      // Игнорируем собственные обновления
      const currentUser = JSON.parse(localStorage.getItem('current_user') || '{}');
      if (data.user_id && data.user_id === currentUser.id) return;

      // Проверяем, что обновление относится к текущему листу
      if (data.sheet_id && currentSheet && data.sheet_id !== currentSheet.id) {
        return;
      }

      const key = `${data.row}_${data.column}`;
      setCells(prev => ({
        ...prev,
        [key]: {
          row: data.row,
          column: data.column,
          value: data.value || '',
          formula: data.formula || '',
          style: data.style || {},
        }
      }));
      
      // Если изменилось значение (не формула), перезагружаем все ячейки,
      // чтобы обновить зависимые формулы
      if (!data.formula && data.value) {
        // Небольшая задержка, чтобы дать серверу время пересчитать зависимости
        setTimeout(() => {
          loadCells();
        }, 200);
      }
    };

    const handleUserJoined = (data) => {
      setActiveUsers(prev => {
        if (!prev.find(u => u.id === data.user_id)) {
          return [...prev, { id: data.user_id, username: data.username }];
        }
        return prev;
      });
    };

    const handleUserLeft = (data) => {
      setActiveUsers(prev => prev.filter(u => u.id !== data.user_id));
      setRemoteCursors(prev => {
        const newCursors = { ...prev };
        delete newCursors[data.user_id];
        return newCursors;
      });
    };

    const handleCursorUpdate = (data) => {
      const currentUser = JSON.parse(localStorage.getItem('current_user') || '{}');
      if (data.user_id === currentUser.id) return;
      setRemoteCursors(prev => ({
        ...prev,
        [data.user_id]: {
          username: data.username,
          row: data.row,
          column: data.column,
        }
      }));
    };

    wsService.on('cell_update', handleCellUpdate);
    wsService.on('user_joined', handleUserJoined);
    wsService.on('user_left', handleUserLeft);
    wsService.on('cursor_update', handleCursorUpdate);

    return () => {
      wsService.off('cell_update', handleCellUpdate);
      wsService.off('user_joined', handleUserJoined);
      wsService.off('user_left', handleUserLeft);
      wsService.off('cursor_update', handleCursorUpdate);
      wsService.disconnect();
    };
  }, [spreadsheet, currentSheet, loadCells]);

  const handleCellChange = async (row, column, value, formula = '', style = null) => {
    if (!currentSheet) return;

    // Сохраняем текущее состояние в историю перед изменением (только если это не отмена/повтор)
    if (historyRef.current.index === historyIndex) {
      saveToHistory(cells);
    }

    // Отправляем обновление через WebSocket
    wsService.send({
      type: 'cell_update',
      sheet_id: currentSheet.id,
      row,
      column,
      value,
      formula,
      style: style || {},
    });

    const key = `${row}_${column}`;
    const updateData = {};
    
    // Если и value, и formula пустые, явно очищаем оба
    if (value === '' && formula === '') {
      updateData.value = '';
      updateData.formula = '';
    } else if (formula) {
      updateData.formula = formula;
    } else {
      updateData.value = value;
    }
    
    if (style !== null) {
      updateData.style = style;
    }

    try {
      const updatedCell = await api.updateCell(currentSheet.id, row, column, updateData);
      setCells(prev => {
        const newCells = {
          ...prev,
          [key]: updatedCell,
        };
        return newCells;
      });
      
      // Если изменилось значение или формула, перезагружаем все ячейки,
      // чтобы обновить зависимые формулы и показать результат вычисления
      if (style === null) {
        // Небольшая задержка, чтобы дать серверу время пересчитать зависимости
        setTimeout(() => {
          loadCells();
        }, 100);
      }
    } catch (error) {
      console.error('Ошибка обновления ячейки:', error);
    }
  };

  const handleAddSheet = async () => {
    try {
      const newSheet = await api.addSheet(spreadsheet.id, `Лист${sheets.length + 1}`);
      setSheets([...sheets, newSheet]);
      setCurrentSheet(newSheet);
    } catch (error) {
      console.error('Ошибка добавления листа:', error);
    }
  };

  const handleDeleteSheet = async (sheetId) => {
    try {
      await api.deleteSheet(sheetId);
      const updatedSheets = sheets.filter(sheet => sheet.id !== sheetId);
      setSheets(updatedSheets);
      
      // Если удалили текущий лист, переключаемся на другой
      if (currentSheet?.id === sheetId) {
        if (updatedSheets.length > 0) {
          setCurrentSheet(updatedSheets[0]);
        } else {
          // Если это был последний лист, создаем новый
          const newSheet = await api.addSheet(spreadsheet.id, 'Лист1');
          setSheets([newSheet]);
          setCurrentSheet(newSheet);
        }
      }
      
      // Перезагружаем листы для синхронизации
      await loadSheets();
    } catch (error) {
      console.error('Ошибка удаления листа:', error);
      const errorMessage = error.response?.data?.error || 
                          error.response?.data?.detail || 
                          'Не удалось удалить лист. Возможно, это последний лист в таблице.';
      alert(errorMessage);
    }
  };

  if (loading) {
    return <div className="editor-loading">Загрузка...</div>;
  }

  return (
    <div className="spreadsheet-editor">
      <div className="editor-header">
        <input
          type="text"
          className="spreadsheet-title"
          value={spreadsheetName}
          onChange={(e) => {
            // Обновляем локально для мгновенного отображения
            setSpreadsheetName(e.target.value);
          }}
          onBlur={async (e) => {
            // Сохраняем при потере фокуса
            const newName = e.target.value.trim();
            if (newName && newName !== spreadsheet.name) {
              try {
                await api.updateSpreadsheet(spreadsheet.id, { name: newName });
                if (onUpdate) {
                  onUpdate();
                }
              } catch (error) {
                console.error('Ошибка обновления названия таблицы:', error);
                // Восстанавливаем старое значение при ошибке
                setSpreadsheetName(spreadsheet.name);
              }
            } else if (!newName) {
              // Если название пустое, восстанавливаем старое
              setSpreadsheetName(spreadsheet.name);
            }
          }}
          onKeyDown={(e) => {
            // Сохраняем при нажатии Enter
            if (e.key === 'Enter') {
              e.preventDefault();
              e.target.blur();
            } else if (e.key === 'Escape') {
              // Отменяем изменения при Escape
              setSpreadsheetName(spreadsheet.name);
              e.target.blur();
            }
          }}
        />
        <div className="editor-toolbar">
          <SheetTabs
            sheets={sheets}
            currentSheet={currentSheet}
            onSelect={setCurrentSheet}
            onAdd={handleAddSheet}
            onUpdate={loadSheets}
            onDelete={handleDeleteSheet}
          />
        </div>
      </div>
      
      {showShareDialog && (
        <ShareDialog
          spreadsheet={spreadsheet}
          onClose={() => setShowShareDialog(false)}
        />
      )}
      
      {currentSheet && (
        <>
          {activeUsers.length > 0 && (
            <div className="active-users">
              <span className="active-users-label">Активные пользователи:</span>
              {activeUsers.map(user => (
                <span key={user.id} className="active-user">{user.username}</span>
              ))}
            </div>
          )}
          <Grid
            cells={cells}
            onCellChange={handleCellChange}
            onUndo={undo}
            onRedo={redo}
            canUndo={historyIndex > 0}
            canRedo={historyIndex < history.length - 1}
            remoteCursors={remoteCursors}
            currentSheet={currentSheet}
            allSheets={sheets}
            onCursorMove={(row, column) => {
              wsService.send({
                type: 'cursor_move',
                row,
                column,
              });
            }}
          />
        </>
      )}
    </div>
  );
}

export default SpreadsheetEditor;

