import { TEMPLATES, normalizeRecord, makeRecord, applyPatches, validatePatches, contextForAssistant } from './workflow.js'
import { readDocument, exportDocx } from './documents.js'
import { requestAI, insertAssistantContext } from './bridge.js'
import { selectionFromValue, valueFromSelection, selectedModelLabel } from './models.js'
import { reviewContract, DEFAULT_RULES } from './review.js'
import styles from './client.css'

window.__ModuleLoader__.load({
  id: 'dsh-contract-review-workbench',
  factory: (require) => {
    const React = require('react'), h = React.createElement
    const DB_NAME = 'dsh-contract-review-workbench-v1'
    const REPOSITORY = 'https://github.com/cinderzhan/dsh-contract-review-workbench'
    let dbPromise
    function database() {
      if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1)
        request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('workbench')) request.result.createObjectStore('workbench') }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => { dbPromise = null; reject(request.error) }
      })
      return dbPromise
    }
    async function loadData() {
      const db = await database()
      return new Promise((resolve, reject) => {
        const request = db.transaction('workbench').objectStore('workbench').get('main')
        request.onsuccess = () => resolve(request.result || { projects: [] })
        request.onerror = () => reject(request.error)
      })
    }
    async function saveData(data) {
      const db = await database()
      return new Promise((resolve, reject) => {
        const tx = db.transaction('workbench', 'readwrite')
        tx.objectStore('workbench').put(data, 'main')
        tx.oncomplete = resolve
        tx.onerror = tx.onabort = () => reject(tx.error || Error('本机存储事务被中断'))
      })
    }
    function Icon({ kind = 'document', ...props }) {
      const paths = { document: 'M7 3h7l4 4v14H7z M14 3v5h5 M10 12h5 M10 16h5', upload: 'M12 16V3 M7 8l5-5 5 5 M4 16v5h16v-5', chat: 'M4 4h16v12H9l-5 4z', history: 'M3 11a9 9 0 1 1 3 8 M3 4v7h7 M12 7v5l3 2', close: 'M6 6l12 12 M18 6L6 18' }
      return h('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, ...props }, h('path', { d: paths[kind] || paths.document }))
    }
    function download(name, content, type = 'text/plain') {
      const url = URL.createObjectURL(new Blob([content], { type: `${type};charset=utf-8` }))
      const a = document.createElement('a'); a.href = url; a.download = name.replace(/[\\/:*?"<>|]/g, '_'); a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
    function report(record) {
      return [`# ${record.name} · 审核记录`, `审核方式：${record.reviewMode === 'basic' ? '基础关键词检查' : 'AI 审核'}`, `审核时间：${record.reviewedAt || '待审核'}`, `模型：${record.model ? `${record.modelProvider || '默认'} / ${record.model}` : '—'}`, '', ...record.issues.flatMap(i => [`## ${i.title}`, i.detail || '', `原文：${i.quote || i.excerpt || '未定位'}`, `建议：${i.suggestion || ''}`, `处理：${i.status || 'open'}`, `备注：${i.note || ''}`, ''])].join('\n')
    }
    function BusinessPanel(props) {
      const { service, active = true } = props
      React.useSyncExternalStore(service.subscribe, service.getSnapshot)
      const sessionList = service.ctx?.sessions?.list
      React.useSyncExternalStore(React.useCallback(listener => sessionList?.subscribe?.(listener) || (() => {}), [sessionList]), React.useCallback(() => service.currentSession?.() || '', [service]), React.useCallback(() => '', []))
      const observedSessionId = service.currentSession?.() || ''
      const [data, setData] = React.useState(null), [selected, setSelected] = React.useState('')
      const [step, setStep] = React.useState(1), [error, setError] = React.useState(''), [saved, setSaved] = React.useState('')
      const [busy, setBusy] = React.useState(''), [history, setHistory] = React.useState(false), [assistant, setAssistant] = React.useState(false)
      const [paste, setPaste] = React.useState(''), [showPaste, setShowPaste] = React.useState(false), [editRule, setEditRule] = React.useState(null)
      const [focusedIssue, setFocusedIssue] = React.useState(''), [focusedPatch, setFocusedPatch] = React.useState(''), [notice, setNotice] = React.useState(''), [retry, setRetry] = React.useState('')
      const [assistantNotice, setAssistantNotice] = React.useState('')
      const [modelCatalog, setModelCatalog] = React.useState(null), [modelError, setModelError] = React.useState(''), [modelLoading, setModelLoading] = React.useState(false)
      const insertedContexts = React.useRef(new Set())
      const lastSession = React.useRef(null)
      const operation = React.useRef(0), abort = React.useRef(null), root = React.useRef(null), dialog = React.useRef(null), returnFocus = React.useRef(null)
      const record = data?.projects.find(item => item.id === selected)
      const latest = React.useRef({ record, selected, active }); latest.current = { record, selected, active }
      React.useEffect(() => {
        let live = true
        loadData().then(value => { if (!live) return; const projects = (value.projects || []).map(item => { const normalized = normalizeRecord(item, value.rules); return { ...normalized, reviewMode: normalized.reviewMode || normalized.reviewKind || (normalized.reviewedAt ? 'basic' : '') } }); setData({ ...value, projects }); const initial = projects.find(item => item.sessionIds?.includes(service.currentSession?.())) || projects[0]; lastSession.current = service.currentSession?.() || ''; if (initial) { setSelected(initial.id); setStep([1, 2, 3, 4].includes(initial.stage) ? initial.stage : 1) } }).catch(() => live && setError('无法读取本机历史文档。请重新打开工作台；当前不会覆盖原有数据。'))
        return () => { live = false; abort.current?.abort(); operation.current++ }
      }, [])
      async function loadModels() {
        setModelLoading(true); setModelError('')
        try {
          const response = await service.request('/api/contract-review/ai', { method: 'GET', credentials: 'same-origin' })
          const result = await response.json()
          if (!response.ok) throw new Error(result.error || '模型列表读取失败。')
          setModelCatalog(result)
        } catch (e) { setModelError(e.message || '模型列表读取失败。') }
        finally { setModelLoading(false) }
      }
      React.useEffect(() => { loadModels() }, [service])
      React.useEffect(() => {
        if (!data) return
        let live = true; setSaved('保存中…')
        saveData(data).then(() => live && setSaved('已保存到本机')).catch(() => { if (live) { setSaved('保存失败'); setError('本机保存失败。请先导出当前文本和审核记录，避免关闭后丢失。') } })
        return () => { live = false }
      }, [data])
      React.useEffect(() => {
        if (!data || lastSession.current === observedSessionId) return
        lastSession.current = observedSessionId
        if (!observedSessionId || service.state?.sessionBindings?.[observedSessionId] !== props.entry?.id) return
        const mapped = data.projects.find(item => item.sessionIds?.includes(observedSessionId))
        if (mapped && mapped.id !== selected) {
          abort.current?.abort(); operation.current++; setBusy(''); setSelected(mapped.id)
          setStep([1, 2, 3, 4].includes(mapped.stage) ? mapped.stage : 1); setError(''); setNotice('')
        }
      }, [observedSessionId, data, selected, service, props.entry?.id])
      React.useEffect(() => { if (!active) { abort.current?.abort(); operation.current++; setBusy('') } }, [active])
      React.useEffect(() => {
        if (!history && !editRule) return
        returnFocus.current = document.activeElement
        const el = dialog.current; el?.querySelector('button,input,textarea')?.focus()
        return () => returnFocus.current?.focus?.()
      }, [history, !!editRule])
      function cancel() { abort.current?.abort(); operation.current++; setBusy(''); setNotice('操作已取消，原有结果保留。') }
      function update(patch, id = selected) { if (!latest.current.active) return; setData(prev => ({ ...prev, projects: prev.projects.map(item => item.id === id ? { ...item, ...patch } : item) })) }
      function configure(patch) { if (!active || busy) return; cancel(); update({ ...patch, rulesChanged: !!record.reviewedAt }); setNotice(record.reviewedAt ? '审核条件已修改。原有结果和处理记录已保留，可重新审核。' : '') }
      function navigate(n) { if (!active || busy || (n > 1 && !record?.text.trim()) || (n > 3 && !record?.reviewedAt)) return; setStep(n); if (record) update({ stage: n }) }
      function addRecord(text, fileName, warnings = []) {
        if (text.length > 60000) { setError('合同超过 60,000 字符，请拆分后审核。'); return }
        const item = { ...makeRecord(text, fileName), warnings }
        setData(prev => ({ ...prev, projects: [item, ...prev.projects] })); setSelected(item.id); setStep(1); setError(''); setNotice(''); setPaste(''); setShowPaste(false); setAssistant(false)
      }
      async function importFile(file) {
        if (!file || !active || busy || !data) return
        setError(''); setBusy('读取文档'); const token = ++operation.current
        try { const result = await readDocument(file); if (token === operation.current && latest.current.active) addRecord(result.text, file.name, result.warnings || []) }
        catch (e) { if (token === operation.current) setError(e.message || '文件读取失败，请重试。') }
        finally { if (token === operation.current) setBusy('') }
      }
      async function chooseWorkspace() {
        if (!active || busy || !record) return
        setError(''); setBusy('等待选择资料位置')
        try {
          const sessionId = await service.newWorkspaceSession()
          if (sessionId && latest.current.active && latest.current.selected === record.id) {
            update({ sessionIds: [...new Set([...(record.sessionIds || []), sessionId])], workspaceSessionId: sessionId }, record.id)
            setNotice('资料位置已选定，后续 AI 审核将在这个工作区的会话中进行。')
          }
        } catch (e) { setError(e.message || '无法选择资料位置。') }
        finally { setBusy('') }
      }
      async function run(mode) {
        if (!active || busy || !record?.text.trim()) return
        const token = ++operation.current, id = record.id
        const workingLabel = mode === 'review' ? 'AI 正在审核合同' : 'AI 正在生成修订建议'
        abort.current = new AbortController(); setError(''); setNotice(''); setRetry(mode); setBusy(ownedSession ? workingLabel : '等待选择资料位置')
        try {
          const result = await requestAI(service, mode, { text: record.text, rules: record.rules, stance: record.stance, instructions: record.instructions, issues: record.issues.filter(i => i.status !== 'ignored'), modelSelection: mode === 'review' ? (record.modelChoice || null) : (record.revisionModelChoice === undefined ? record.modelChoice || null : record.revisionModelChoice), sessionIds: record.workspaceSessionId ? [record.workspaceSessionId] : [], otherSessionIds: data.projects.filter(p => p.id !== record.id).flatMap(p => p.sessionIds || []) }, { signal: abort.current.signal, onSessionReady: sessionId => { if (token === operation.current) { update({ sessionIds: [...new Set([...(record.sessionIds || []), sessionId])], workspaceSessionId: sessionId }, id); setBusy(workingLabel) } } })
          if (token !== operation.current || latest.current.selected !== id || !latest.current.active) return
          const sessionIds = [...new Set([...(record.sessionIds || []), ...(result.sessionId ? [result.sessionId] : [])])]
          if (mode === 'review') {
            // Retain prior review and decisions before a deliberate rerun.
            update({ sessionIds, issues: result.issues, model: result.model, modelProvider: result.provider, revisionModelChoice: record.revisionModelChoice === undefined ? { provider: result.provider, model: result.model } : record.revisionModelChoice, reviewMode: 'ai', reviewedAt: new Date().toLocaleString('zh-CN'), rulesChanged: false, stage: 3, reviewHistory: [...(record.reviewHistory || []), ...(record.reviewedAt ? [{ issues: record.issues, patches: record.patches, reviewedAt: record.reviewedAt, model: record.model, modelProvider: record.modelProvider, revisionModel: record.revisionModel, revisionModelProvider: record.revisionModelProvider }] : [])], patches: [] }, id); setStep(3)
          } else { const patches = validatePatches(record.text, result.patches); update({ sessionIds, patches, revisionModel: result.model, revisionModelProvider: result.provider, stage: 4, patchHistory: [...(record.patchHistory || []), ...(record.patches.length ? [{ patches: record.patches, model: record.revisionModel, provider: record.revisionModelProvider }] : [])] }, id); setStep(4) }
        } catch (e) { if (token === operation.current && e.name !== 'AbortError') setError(e.message || 'AI 操作失败，请检查模型连接后重试。') }
        finally { if (token === operation.current) setBusy('') }
      }
      function basicCheck() {
        if (!active || busy) return
        const issues = reviewContract(record.text, DEFAULT_RULES)
        update({ issues, model: '', modelProvider: '', reviewMode: 'basic', reviewedAt: new Date().toLocaleString('zh-CN'), stage: 3, rulesChanged: false, reviewHistory: [...(record.reviewHistory || []), ...(record.reviewedAt ? [{ issues: record.issues, patches: record.patches, reviewedAt: record.reviewedAt, model: record.model, modelProvider: record.modelProvider, revisionModel: record.revisionModel, revisionModelProvider: record.revisionModelProvider }] : [])], patches: [] }); setStep(3)
      }
      function issueUpdate(id, patch) { if (!active || busy) return; update({ issues: record.issues.map(i => i.id === id ? { ...i, ...patch } : i) }) }
      function patchUpdate(id, status) { if (!active || busy) return; update({ patches: record.patches.map(p => p.id === id ? { ...p, status } : p) }) }
      function btn(label, action, primary = false, disabled = false, icon) { return h('button', { type: 'button', className: `cr-button${primary ? ' cr-primary' : ''}`, disabled: !active || disabled || !!busy, onClick: action }, icon && h(Icon, { kind: icon }), label) }
      function documentView(text, quote, className = '') {
        const index = quote ? text.indexOf(quote) : -1
        return h('div', { className: `cr-document ${className}`, tabIndex: 0, 'aria-label': '合同文本' }, index < 0 ? text : [text.slice(0, index), h('mark', { key: 'quote', ref: el => { if (el) el.scrollIntoView({ block: 'nearest' }) } }, quote), text.slice(index + quote.length)])
      }
      function comparisonView(revised) {
        if (!record.patches.length || revisionError) return documentView(revised ? revision : record.text)
        const patches = validatePatches(record.text, record.patches).filter(p => p.status !== 'rejected')
        let cursor = 0
        const children = []
        for (const patch of patches) {
          children.push(record.text.slice(cursor, patch.start))
          children.push(h('mark', { key: patch.id, className: revised ? 'cr-added' : 'cr-removed', ref: el => { if (el && focusedPatch === patch.id) el.scrollIntoView({ block: 'nearest' }) } }, revised ? (patch.original ? patch.replacement : `\n\n${patch.replacement}`) : patch.original))
          cursor = patch.end
        }
        children.push(record.text.slice(cursor))
        return h('div', { className: 'cr-document', tabIndex: 0, 'aria-label': revised ? '修订预览' : '合同原文' }, children)
      }
      function closeModal() { setHistory(false); setEditRule(null) }
      function dialogKeys(e) {
        if (e.key === 'Escape') { e.preventDefault(); closeModal() }
        if (e.key === 'Tab') { const nodes = [...dialog.current.querySelectorAll('button,input,textarea,select,[tabindex="0"]')].filter(n => !n.disabled); const first = nodes[0], last = nodes.at(-1); if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() } }
      }
      async function copyContext() { try { await navigator.clipboard.writeText(contextForAssistant(record, issue)); setNotice('审核上下文已复制，可粘贴到助手对话中。') } catch { setError('无法复制到剪贴板，请检查 Desktop 的剪贴板权限。') } }
      const issue = record?.issues.find(i => i.id === focusedIssue)
      let revision = record?.text || '', revisionError = ''
      try { if (record?.patches.length) revision = applyPatches(record.text, record.patches, { preview: true }) } catch(e) { revisionError = e.message }
      const currentSession = service.currentSession?.()
      const currentSessionId = typeof currentSession === 'string' ? currentSession : currentSession?.id
      const ownedSession = currentSessionId && record?.workspaceSessionId === currentSessionId && service.state?.sessionBindings?.[currentSessionId] === props.entry?.id
      const reviewActionLabel = ownedSession ? (record?.reviewedAt ? '按新条件重新审核' : '开始 AI 审核') : '选择资料位置并开始 AI 审核'
      const conversation = ownedSession ? props.conversation : null
      function insertContext(explicit = false) {
        if (!active || !record || !ownedSession) { setAssistantNotice('请先新建工作台会话，再带入审核上下文。'); return }
        const base = `${currentSessionId}:${record.id}:${record.reviewedAt || ''}`
        const key = explicit ? `${base}:${focusedIssue}` : base
        if (insertedContexts.current.has(key)) { if (explicit) setAssistantNotice('此审核上下文已带入草稿，可在助手中确认后发送。'); return }
        try {
          insertAssistantContext(service, props.entry.id, contextForAssistant(record, issue))
          insertedContexts.current.add(key)
          if (!explicit) insertedContexts.current.add(`${base}:${focusedIssue}`)
          setAssistantNotice('当前合同和审核要求已带入助手草稿，确认后发送。')
        } catch { setAssistantNotice('助手尚未准备好，可点击带入上下文重试。') }
      }
      React.useEffect(() => {
        if (assistant && ownedSession && active && record) insertContext(false)
      }, [assistant, currentSessionId, selected, record?.reviewedAt, active, ownedSession])

      return h('section', { className: 'dshContract', ref: root, 'aria-label': '合同审核工作台' },
        h('header', { className: 'cr-header' }, h('div', { className: 'cr-brand' }, h(Icon), h('h1', null, '合同审核')), h('div', { className: 'cr-toolbar' }, h('span', { className: 'cr-save', role: 'status' }, saved), btn('历史文档', () => setHistory(true), false, !data, 'history'), btn('审核助手', () => setAssistant(!assistant), false, !record, 'chat'))),
        h('nav', { className: 'cr-steps', 'aria-label': '审核步骤' }, ['上传合同', '选择规则', '审核结果', '修改对比'].map((label, i) => h('button', { key: label, type: 'button', 'aria-current': step === i + 1 ? 'step' : undefined, disabled: !active || !!busy || (i > 0 && !record?.text.trim()) || (i > 2 && !record?.reviewedAt), onClick: () => navigate(i + 1) }, h('span', { className: 'cr-step-number' }, i + 1), label))),
        h('div', { className: `cr-workspace${assistant ? ' cr-with-assistant' : ''}` }, h('main', { className: 'cr-main' },
          error && h('div', { className: 'cr-alert cr-error', role: 'alert' }, h('span', null, error), retry && btn('重试', () => run(retry))),
          notice && h('div', { className: 'cr-alert', role: 'status' }, notice),
          busy && h('div', { className: 'cr-alert cr-loading', role: 'status' }, h('span', null, `${busy}…`), busy !== '等待选择资料位置' && h('button', { className: 'cr-button', onClick: cancel }, '取消')),
          !data ? h('div', { className: 'cr-empty' }, error ? '本机数据暂不可用' : '正在读取本机文档…') :
          step === 1 ? h('div', { className: 'cr-narrow' }, h('div', { className: 'cr-heading' }, h('h2', null, '从一份合同开始'), h('p', null, '上传文档，确认正文后选择审核规则。')),
            h('label', { className: 'cr-upload', onDragOver: e => e.preventDefault(), onDrop: e => { e.preventDefault(); importFile(e.dataTransfer.files[0]) } }, h(Icon, { kind: 'upload', width: 28, height: 28 }), h('strong', null, busy === '读取文档' ? '正在读取…' : '选择文件或拖放到这里'), h('span', null, 'Word、PDF、TXT、Markdown · 最大 15 MB'), h('input', { type: 'file', accept: '.txt,.md,.docx,.pdf', disabled: !active || !!busy, onChange: e => { importFile(e.target.files[0]); e.target.value = '' }, 'aria-label': '上传合同文件' })),
            h('div', { className: 'cr-paste-toggle' }, btn(showPaste ? '收起文本输入' : '也可以粘贴合同文本', () => setShowPaste(!showPaste))),
            showPaste && h('div', { className: 'cr-paste' }, h('textarea', { value: paste, disabled: !active || !!busy, maxLength: 60000, onChange: e => setPaste(e.target.value), rows: 8, placeholder: '粘贴合同正文…', 'aria-label': '粘贴合同正文' }), btn('使用这份文本', () => addRecord(paste, '粘贴的合同'), false, !paste.trim())),
            record && h('section', { className: 'cr-preview' }, h('div', { className: 'cr-row' }, h('h3', null, record.sourceName || record.name), h('span', { className: 'cr-muted' }, `${record.text.length.toLocaleString()} 字符`)), record.warnings?.map((w, i) => h('p', { className: 'cr-alert', key: i }, w)), documentView(record.text, null, 'cr-short'), h('p', { className: 'cr-help' }, '原文将保留。上传新文件会创建独立记录。'), h('div', { className: 'cr-bottom' }, btn('下一步：选择规则', () => navigate(2), true, !record.text.trim())))) :
          step === 2 && record ? h('div', { className: 'cr-narrow' }, h('div', { className: 'cr-heading' }, h('h2', null, '确定这次审核的重点'), h('p', null, record.sourceName || record.name)),
            h('div', { className: 'cr-settings' }, h('label', null, '规则模板', h('select', { value: record.templateId, disabled: !active || !!busy, onChange: e => { const template = TEMPLATES.find(t => t.id === e.target.value); configure({ templateId: template.id, rules: template.rules.map(r => ({ ...r })) }) } }, TEMPLATES.map(t => h('option', { key: t.id, value: t.id }, t.title)))), h('label', null, '审核立场', h('select', { value: record.stance, disabled: !active || !!busy, onChange: e => configure({ stance: e.target.value }) }, h('option', { value: 'neutral' }, '中立审查'), h('option', { value: 'partyA' }, '站在甲方立场'), h('option', { value: 'partyB' }, '站在乙方立场')))),
            h('p', { className: 'cr-help' }, TEMPLATES.find(t => t.id === record.templateId)?.description), h('div', { className: 'cr-rule-list' }, record.rules.map(rule => h('div', { className: 'cr-rule', key: rule.id }, h('label', { className: 'cr-check' }, h('input', { type: 'checkbox', checked: rule.enabled !== false, disabled: !active || !!busy, onChange: e => configure({ rules: record.rules.map(r => r.id === rule.id ? { ...r, enabled: e.target.checked } : r) }) }), h('span', null, rule.title)), h('div', { className: 'cr-toolbar' }, btn('编辑', () => setEditRule({ ...rule })), btn('移除', () => configure({ rules: record.rules.filter(r => r.id !== rule.id) })))))),
            btn('添加自定义规则', () => setEditRule({ id: `custom-${Date.now()}`, title: '', guidance: '', enabled: true })), h('label', { className: 'cr-additional' }, '本次补充要求（可选）', h('textarea', { rows: 3, value: record.instructions, disabled: !active || !!busy, placeholder: '例如：重点关注付款期限和验收条件，希望措辞保持温和。', onChange: e => configure({ instructions: e.target.value }) })), h('div', { className: 'cr-model-setting' }, h('label', null, '审核模型', h('select', { value: valueFromSelection(record.modelChoice), disabled: !active || !!busy || modelLoading, onChange: e => configure({ modelChoice: selectionFromValue(e.target.value) }) }, h('option', { value: '' }, `跟随 DSH 默认模型${modelCatalog?.default ? `（${selectedModelLabel(null, modelCatalog)}）` : ''}`), modelCatalog?.groups?.map(group => h('optgroup', { key: group.id, label: group.name }, group.models.map(model => h('option', { key: model.id, value: valueFromSelection({ provider: group.id, model: model.id }) }, model.name))))), h('p', { className: 'cr-help' }, '当前选择：', selectedModelLabel(record.modelChoice, modelCatalog), '。合同文本将发送给该模型服务商。'), modelError && h('p', { className: 'cr-help', role: 'status' }, modelError), btn(modelLoading ? '正在读取模型…' : '刷新模型列表', loadModels, false, modelLoading))), h('p', { className: 'cr-help' }, ownedSession ? 'AI 审核将在当前合同已选择的资料位置继续。' : '首次审核或旧合同升级后，先选择 AI 会话的资料文件夹；取消后不会开始审核。合同与审核记录仍保存在 Desktop 本机数据库。'), record.workspaceSessionId && btn('更换资料位置', chooseWorkspace), h('div', { className: 'cr-bottom' }, btn('返回文档', () => navigate(1)), btn(reviewActionLabel, () => run('review'), true, !record.rules.some(r => r.enabled !== false))), h('details', { className: 'cr-basic' }, h('summary', null, '仅做本机基础检查'), h('p', null, '使用固定基础规则检查关键词和待填写位置，不使用上方 AI 审核规则。'), btn('运行基础关键词检查', basicCheck))) :
          step === 3 && record ? h('div', { className: 'cr-review' }, h('div', { className: 'cr-heading cr-row' }, h('div', null, h('h2', null, record.reviewedAt ? `审核结果 · ${record.issues.length} 项` : '准备审核'), h('p', null, record.reviewedAt ? `${record.reviewMode === 'basic' ? '基础关键词检查' : `AI 审核 · ${record.modelProvider || '默认'} / ${record.model || '未知模型'}`} · ${record.reviewedAt}${record.rulesChanged ? ' · 审核条件已变更' : ''}` : '完成规则选择后，点击开始 AI 审核。')), btn('导出审核记录', () => download(`${record.name}-审核记录.md`, report(record), 'text/markdown'), false, !record.reviewedAt)),
            h('div', { className: 'cr-review-grid' }, h('section', { className: 'cr-paper' }, h('h3', null, '合同原文'), documentView(record.text, issue?.quote || issue?.excerpt)), h('section', { className: 'cr-results', 'aria-label': '审核问题' }, !record.reviewedAt ? h('div', { className: 'cr-empty' }, '尚未运行审核', btn(reviewActionLabel, () => run('review'), true)) : !record.issues.length ? h('div', { className: 'cr-empty' }, h('h3', null, '本次未发现问题'), h('p', null, record.reviewMode === 'basic' ? '基础检查仅覆盖关键词和占位符，可返回规则页运行 AI 审核。' : '请结合业务背景复核合同全文。')) : record.issues.map(i => h('article', { className: `cr-issue${focusedIssue === i.id ? ' is-selected' : ''}`, key: i.id }, h('button', { className: 'cr-issue-title', onClick: () => setFocusedIssue(i.id) }, h('span', { className: `cr-severity ${i.severity}` }, { high: '高风险', medium: '需关注', low: '建议' }[i.severity] || '需关注'), h('h3', null, i.title)), h('p', null, i.detail), (i.quote || i.excerpt) && h('blockquote', null, i.quote || i.excerpt), i.suggestion && h('p', { className: 'cr-suggestion' }, i.suggestion), h('div', { className: 'cr-row cr-issue-actions' }, h('select', { value: i.status || 'open', disabled: !active || !!busy, 'aria-label': `${i.title}处理状态`, onChange: e => issueUpdate(i.id, { status: e.target.value }) }, h('option', { value: 'open' }, '待处理'), h('option', { value: 'confirmed' }, '确认需要修改'), h('option', { value: 'ignored' }, '忽略此项'))), h('details', null, h('summary', null, i.note ? '查看审核备注' : '添加备注'), h('textarea', { rows: 2, value: i.note || '', disabled: !active || !!busy, 'aria-label': `${i.title}备注`, onChange: e => issueUpdate(i.id, { note: e.target.value }) })))))), h('div', { className: 'cr-model-setting' }, h('label', null, '修改稿模型', h('select', { value: valueFromSelection(record.revisionModelChoice === undefined ? record.modelChoice : record.revisionModelChoice), disabled: !active || !!busy || modelLoading, onChange: e => update({ revisionModelChoice: selectionFromValue(e.target.value) }) }, h('option', { value: '' }, `跟随 DSH 默认模型${modelCatalog?.default ? `（${selectedModelLabel(null, modelCatalog)}）` : ''}`), modelCatalog?.groups?.map(group => h('optgroup', { key: group.id, label: group.name }, group.models.map(model => h('option', { key: model.id, value: valueFromSelection({ provider: group.id, model: model.id }) }, model.name))))), h('p', { className: 'cr-help' }, '默认沿用审核模型；改选仅影响下一次生成。', record.revisionModel ? `上次生成：${record.revisionModelProvider || '默认'} / ${record.revisionModel}` : ''))), h('div', { className: 'cr-bottom' }, btn('调整规则', () => navigate(2)), btn('生成 AI 修订稿', () => run('revise'), true, !record.reviewedAt || !record.issues.some(i => i.status !== 'ignored')))) :
          step === 4 && record ? h('div', { className: 'cr-comparison' }, h('div', { className: 'cr-heading' }, h('h2', null, '对照原文，确认每一处修改'), h('p', null, '右侧预览包含待确认建议；导出时只包含已接受的修改。')), revisionError && h('div', { className: 'cr-alert cr-error' }, revisionError), h('div', { className: 'cr-compare-grid' }, h('section', { className: 'cr-paper' }, h('h3', null, '原文'), comparisonView(false)), h('section', { className: 'cr-paper' }, h('h3', null, '修订预览'), comparisonView(true))),
            h('div', { className: 'cr-patches' }, record.patches.length ? record.patches.map(p => h('article', { className: 'cr-patch', key: p.id }, h('div', null, h('button', { className: 'cr-issue-title', onClick: () => setFocusedPatch(p.id), 'aria-label': '定位这处修改' }, h('h3', null, p.reason || '条款修改建议')), h('div', { className: 'cr-diff' }, h('del', null, p.original || '（新增内容）'), h('ins', null, p.replacement || '（删除此内容）'))), h('div', { className: 'cr-patch-actions' }, h('span', { className: 'cr-muted' }, { pending: '待确认', accepted: '已接受', rejected: '已拒绝' }[p.status] || '待确认'), btn('接受', () => patchUpdate(p.id, 'accepted'), false, p.status === 'accepted'), btn('拒绝', () => patchUpdate(p.id, 'rejected'), false, p.status === 'rejected')))) : h('div', { className: 'cr-empty' }, '暂无修订建议。返回审核结果生成修订稿。')),
            h('div', { className: 'cr-bottom' }, btn('返回审核结果', () => navigate(3)), h('div', { className: 'cr-toolbar' }, btn('全部接受', () => update({ patches: record.patches.map(p => ({ ...p, status: 'accepted' })) }), false, !record.patches.length || !!revisionError), btn('导出修订稿 Word', async () => { try { await exportDocx(`${record.name}-修订稿`, applyPatches(record.text, record.patches, { preview: false })) } catch(e) { setError(e.message) } }, true, !!revisionError)))) : null,
          record && h('div', { className: 'cr-footnote' }, btn('导出原文 TXT', () => download(`${record.name}-原文.txt`, record.text)), h('span', null, '原文与处理记录保存在 Desktop 本机数据库；工作区用于 AI 会话。'))),
          assistant && h('aside', { className: 'cr-assistant', 'aria-label': '审核助手' }, h('div', { className: 'cr-row' }, h('h3', null, '审核助手'), btn('收起', () => setAssistant(false))), h('p', { className: 'cr-help' }, '解释风险、补充背景，或讨论更合适的措辞。'), btn('带入当前审核上下文', () => insertContext(true), false, !record || !ownedSession), btn('复制上下文', copyContext, false, !record), assistantNotice && h('p', { className: 'cr-help', role: 'status' }, assistantNotice), conversation ? h('div', { className: 'cr-conversation' }, conversation) : h('div', { className: 'cr-empty' }, '创建工作台会话后，即可与助手讨论。', btn('选择资料位置并新建会话', async () => { try { const created = await service.newWorkspaceSession(); if (created) { update({ sessionIds: [...new Set([...(record.sessionIds || []), created])], workspaceSessionId: created }); setNotice('当前合同的工作台会话已创建，可带入上下文后开始讨论。') } } catch(e) { setError(e.message || '无法创建会话') } })))),
        (history || editRule) && h('div', { className: 'cr-overlay', onClick: e => { if (e.target === e.currentTarget) closeModal() } }, h('section', { className: 'cr-dialog', ref: dialog, role: 'dialog', 'aria-modal': true, 'aria-label': history ? '历史文档' : '编辑审核规则', onKeyDown: dialogKeys }, h('div', { className: 'cr-row' }, h('h2', null, history ? '历史文档' : '编辑审核规则'), btn('关闭', closeModal)), history ? h('div', { className: 'cr-history' }, !data.projects.length ? h('p', null, '还没有历史文档。') : data.projects.map(item => h('button', { className: 'cr-history-item', key: item.id, onClick: () => { cancel(); setSelected(item.id); setStep([1, 2, 3, 4].includes(item.stage) ? item.stage : 1); setHistory(false); setAssistant(false); setError(''); setNotice('') } }, h('span', null, h('strong', null, item.name), h('small', null, item.sourceName)), h('span', null, item.reviewedAt ? `${item.issues.length} 项结果` : '待审核')))) : h('div', { className: 'cr-rule-form' }, h('label', null, '规则名称', h('input', { value: editRule.title, onChange: e => setEditRule({ ...editRule, title: e.target.value }) })), h('label', null, '审核要求', h('textarea', { rows: 6, value: editRule.guidance || '', onChange: e => setEditRule({ ...editRule, guidance: e.target.value }) })), btn('保存规则', () => { configure({ rules: record.rules.some(r => r.id === editRule.id) ? record.rules.map(r => r.id === editRule.id ? editRule : r) : [...record.rules, editRule] }); setEditRule(null) }, true, !editRule.title.trim()))))
      )
    }
    function apply(ctx) {
      ctx.effect(() => {
        const style = document.createElement('style'); style.textContent = styles; document.head.append(style)
        const unregister = ctx.desktopWorkbenches.register({ title: '合同审核工作台', panelTitle: '合同审核', repository: REPOSITORY, description: '上传合同、选择规则、AI 审核与修订对比', customFrame: true, icon: Icon }, BusinessPanel)
        return () => { unregister(); style.remove() }
      })
    }
    return { apply, inject: ['desktopWorkbenches'] }
  }
})
