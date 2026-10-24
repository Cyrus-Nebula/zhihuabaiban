/**
 * 本地文件存储（localStorage）。
 * 画板文件只存在你自己的浏览器里，不上传任何服务器。
 */
const Store = (() => {
  const KEY = 'dajiao_clone_files_v1';

  function readAll() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || '[]');
    } catch {
      return [];
    }
  }

  function writeAll(list) {
    localStorage.setItem(KEY, JSON.stringify(list));
  }

  function genId() {
    return 'f_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  return {
    list() {
      return readAll().sort(
        (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0) || (b.createdAt || 0) - (a.createdAt || 0)
      );
    },
    get(id) {
      return readAll().find((f) => f.id === id) || null;
    },
    create(name, mode) {
      const file = {
        id: genId(),
        name: name || '未命名画板',
        mode: mode === '3d' ? '3d' : '2d',
        content: null, // 打开一次编辑器后会自动回填完整工程数据
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const all = readAll();
      all.push(file);
      writeAll(all);
      return file;
    },
    rename(id, name) {
      const all = readAll();
      const f = all.find((x) => x.id === id);
      if (f) {
        f.name = (name || '').trim() || f.name;
        f.updatedAt = Date.now();
        writeAll(all);
      }
    },
    saveContent(id, content) {
      const all = readAll();
      const f = all.find((x) => x.id === id);
      if (f) {
        f.content = content;
        f.updatedAt = Date.now();
        writeAll(all);
      }
    },
    remove(id) {
      writeAll(readAll().filter((f) => f.id !== id));
    },
    /** 导出为 .json 工程文件 */
    exportFile(id) {
      const f = this.get(id);
      if (!f) return null;
      const blob = new Blob([JSON.stringify(f, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (f.name || '画板') + '.json';
      a.click();
      URL.revokeObjectURL(a.href);
    },
    /** 从 .json 工程文件导入 */
    importFile(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const data = JSON.parse(reader.result);
            const all = readAll();
            const imported = {
              id: genId(),
              name: (data.name || '导入的画板') + '（导入）',
              mode: data.mode === '3d' ? '3d' : '2d',
              content: data.content || null,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            };
            all.push(imported);
            writeAll(all);
            resolve(imported);
          } catch (e) {
            reject(new Error('文件格式不正确：' + e.message));
          }
        };
        reader.onerror = () => reject(new Error('读取文件失败'));
        reader.readAsText(file);
      });
    },
  };
})();
