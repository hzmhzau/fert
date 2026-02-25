/**
 * 数据库操作模块 - 施肥推荐系统数据持久化
 * 对应原 Python database.py + models.py
 * 使用纯 JavaScript JSON 文件存储（无需 C++ 编译，跨平台兼容）
 */

'use strict';

const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'fertilizer_data.json');

/**
 * 纯 JavaScript JSON 文件数据库
 * 无需任何原生模块编译，Windows/Mac/Linux 全平台兼容
 * 数据保存在 fertilizer_data.json 文件中，重启后数据不丢失
 */
class DatabaseManager {
  constructor(dbPath) {
    this.dbPath = dbPath || DB_PATH;
    this._data = { calculations: [], user_sessions: [] };
    this._nextId = 1;
    this._dirty = false;
    this._saveTimer = null;
  }

  /**
   * 初始化：从文件加载已有数据
   */
  init() {
    try {
      if (fs.existsSync(this.dbPath)) {
        const raw = fs.readFileSync(this.dbPath, 'utf-8');
        this._data = JSON.parse(raw);
        // 确保字段存在
        if (!Array.isArray(this._data.calculations)) this._data.calculations = [];
        if (!Array.isArray(this._data.user_sessions)) this._data.user_sessions = [];
        if (!Array.isArray(this._data.historical_yields)) this._data.historical_yields = [];
        // 恢复自增ID
        const ids = this._data.calculations.map(r => r.id || 0);
        this._nextId = ids.length ? Math.max(...ids) + 1 : 1;
        console.log(`数据库已加载: ${this.dbPath}（共 ${this._data.calculations.length} 条记录）`);
      } else {
        this._save(); // 创建空文件
        console.log(`数据库已初始化: ${this.dbPath}`);
      }
    } catch (e) {
      console.warn('加载数据库文件失败，使用空数据库:', e.message);
      this._data = { calculations: [], user_sessions: [] };
    }
  }

  /** 异步延迟写入（避免频繁IO） */
  _scheduleSave() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._save(), 500);
  }

  _save() {
    try {
      fs.writeFileSync(this.dbPath, JSON.stringify(this._data, null, 2), 'utf-8');
    } catch (e) {
      console.error('保存数据库文件失败:', e.message);
    }
  }

  /**
   * 保存施肥计算记录
   * @param {Object} data 计算数据
   * @returns {number|null} 记录ID
   */
  saveCalculation(data) {
    try {
      const record = {
        id: this._nextId++,
        timestamp: new Date().toISOString(),
        crop_type: data.crop_type,
        target_yield: data.target_yield,
        longitude: data.longitude,
        latitude: data.latitude,
        sowing_date: data.sowing_date || null,
        soil_n: data.soil_n ?? null,
        soil_p: data.soil_p ?? null,
        soil_k: data.soil_k ?? null,
        use_custom_soil: !!data.use_custom_soil,
        organic_matter: data.organic_matter ?? null,
        soil_ph: data.soil_ph ?? null,
        straw_return_amount: data.straw_return_amount ?? null,
        fertilizer_recommendation: data.fertilizer_recommendation,
        user_session: data.user_session || null,
        user_ip: data.user_ip || null,
        user_agent: data.user_agent || null,
        data_source: data.data_source || 'online',
        is_default_data: !!data.is_default_data
      };

      this._data.calculations.push(record);
      this._updateUserSession(data.user_session, data.user_ip, data.user_agent);
      this._scheduleSave();

      console.log(`计算记录已保存: ID=${record.id}, 作物=${data.crop_type}, 产量=${data.target_yield}`);
      return record.id;
    } catch (e) {
      console.error('保存计算记录失败:', e.message);
      return null;
    }
  }

  _updateUserSession(sessionId, ipAddress, userAgent) {
    if (!sessionId) return;
    const existing = this._data.user_sessions.find(s => s.id === sessionId);
    if (existing) {
      existing.last_activity = new Date().toISOString();
      existing.calculation_count = (existing.calculation_count || 0) + 1;
    } else {
      this._data.user_sessions.push({
        id: sessionId,
        created_at: new Date().toISOString(),
        last_activity: new Date().toISOString(),
        ip_address: ipAddress || null,
        user_agent: userAgent || null,
        calculation_count: 1
      });
    }
  }

  /**
   * 根据ID获取计算记录
   */
  getCalculationById(id) {
    return this._data.calculations.find(r => r.id === id) || null;
  }

  /**
   * 获取最近的计算记录
   */
  getRecentCalculations(limit = 20, offset = 0, userSession = null) {
    let store = [...this._data.calculations].reverse();
    if (userSession) store = store.filter(r => r.user_session === userSession);
    return store.slice(offset, offset + limit);
  }

  /**
   * 搜索计算记录
   */
  searchCalculations(filters = {}, limit = 50, offset = 0) {
    let store = [...this._data.calculations].reverse();
    if (filters.crop_type) store = store.filter(r => r.crop_type === filters.crop_type);
    if (filters.start_date) store = store.filter(r => r.timestamp >= filters.start_date);
    if (filters.end_date) store = store.filter(r => r.timestamp <= filters.end_date);
    if (filters.min_yield != null) store = store.filter(r => r.target_yield >= filters.min_yield);
    if (filters.max_yield != null) store = store.filter(r => r.target_yield <= filters.max_yield);
    if (filters.region) {
      const rg = filters.region;
      if (rg.min_lon != null) store = store.filter(r => r.longitude >= rg.min_lon);
      if (rg.max_lon != null) store = store.filter(r => r.longitude <= rg.max_lon);
      if (rg.min_lat != null) store = store.filter(r => r.latitude >= rg.min_lat);
      if (rg.max_lat != null) store = store.filter(r => r.latitude <= rg.max_lat);
    }
    return store.slice(offset, offset + limit);
  }

  /**
   * 获取统计信息
   */
  getStatistics(days = 30) {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const all = this._data.calculations;
    const recent = all.filter(r => r.timestamp >= cutoff);
    const cropStats = {};
    for (const r of recent) {
      if (!cropStats[r.crop_type]) cropStats[r.crop_type] = { total: 0, online: 0, offline: 0, custom: 0 };
      cropStats[r.crop_type].total++;
      if (r.data_source) cropStats[r.crop_type][r.data_source] = (cropStats[r.crop_type][r.data_source] || 0) + 1;
    }
    return {
      total_calculations: all.length,
      recent_calculations: recent.length,
      crop_distribution: cropStats,
      average_yield: { 水稻: 500, 小麦: 400 },
      period_days: days
    };
  }

  /**
   * 导出数据
   */
  exportData(format = 'json', filters = null) {
    const data = filters ? this.searchCalculations(filters, 1000) : this.getRecentCalculations(1000);
    if (format === 'json') return JSON.stringify(data, null, 2);
    if (format === 'csv') {
      if (!data.length) return '';
      const fields = Object.keys(data[0]);
      const lines = [fields.join(',')];
      for (const item of data) {
        const row = fields.map(f => {
          let v = item[f] ?? '';
          if (typeof v === 'object') v = JSON.stringify(v);
          return String(v).replace(/,/g, ';');
        });
        lines.push(row.join(','));
      }
      return lines.join('\n');
    }
    return '';
  }

  /**
   * 清理旧数据
   */
  cleanupOldData(daysToKeep = 90) {
    const cutoff = new Date(Date.now() - daysToKeep * 86400000).toISOString();
    const before = this._data.calculations.length;
    this._data.calculations = this._data.calculations.filter(r => r.timestamp >= cutoff);
    this._data.user_sessions = this._data.user_sessions.filter(s => s.last_activity >= cutoff);
    const deleted = before - this._data.calculations.length;
    if (deleted > 0) { this._save(); console.log(`清理了 ${deleted} 条旧记录`); }
    return deleted;
  }

  /**
   * 保存近三年历史产量和施肥数据
   * @param {Object} data 历史数据
   * @returns {number|null} 记录ID
   */
  saveHistoricalYield(data) {
    try {
      if (!Array.isArray(this._data.historical_yields)) this._data.historical_yields = [];
      const record = {
        id: Date.now(),
        timestamp: new Date().toISOString(),
        location: data.location || null,
        longitude: data.longitude ?? null,
        latitude: data.latitude ?? null,
        // 水稻近三年数据
        rice_year1_yield: data.rice_year1_yield ?? null,
        rice_year2_yield: data.rice_year2_yield ?? null,
        rice_year3_yield: data.rice_year3_yield ?? null,
        rice_avg_yield: data.rice_avg_yield ?? null,
        rice_year1_n: data.rice_year1_n ?? null,
        rice_year1_p: data.rice_year1_p ?? null,
        rice_year1_k: data.rice_year1_k ?? null,
        rice_year2_n: data.rice_year2_n ?? null,
        rice_year2_p: data.rice_year2_p ?? null,
        rice_year2_k: data.rice_year2_k ?? null,
        rice_year3_n: data.rice_year3_n ?? null,
        rice_year3_p: data.rice_year3_p ?? null,
        rice_year3_k: data.rice_year3_k ?? null,
        rice_avg_n: data.rice_avg_n ?? null,
        rice_avg_p: data.rice_avg_p ?? null,
        rice_avg_k: data.rice_avg_k ?? null,
        // 小麦近三年数据
        wheat_year1_yield: data.wheat_year1_yield ?? null,
        wheat_year2_yield: data.wheat_year2_yield ?? null,
        wheat_year3_yield: data.wheat_year3_yield ?? null,
        wheat_avg_yield: data.wheat_avg_yield ?? null,
        wheat_year1_n: data.wheat_year1_n ?? null,
        wheat_year1_p: data.wheat_year1_p ?? null,
        wheat_year1_k: data.wheat_year1_k ?? null,
        wheat_year2_n: data.wheat_year2_n ?? null,
        wheat_year2_p: data.wheat_year2_p ?? null,
        wheat_year2_k: data.wheat_year2_k ?? null,
        wheat_year3_n: data.wheat_year3_n ?? null,
        wheat_year3_p: data.wheat_year3_p ?? null,
        wheat_year3_k: data.wheat_year3_k ?? null,
        wheat_avg_n: data.wheat_avg_n ?? null,
        wheat_avg_p: data.wheat_avg_p ?? null,
        wheat_avg_k: data.wheat_avg_k ?? null,
        user_session: data.user_session || null,
        user_ip: data.user_ip || null,
        notes: data.notes || null
      };
      this._data.historical_yields.push(record);
      this._scheduleSave();
      console.log(`历史产量记录已保存: ID=${record.id}`);
      return record.id;
    } catch (e) {
      console.error('保存历史产量记录失败:', e.message);
      return null;
    }
  }

  /**
   * 获取历史产量记录列表
   */
  getHistoricalYields(limit = 50, offset = 0) {
    if (!Array.isArray(this._data.historical_yields)) return [];
    return [...this._data.historical_yields].reverse().slice(offset, offset + limit);
  }

  close() {
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._save(); }
  }
}

module.exports = DatabaseManager;
