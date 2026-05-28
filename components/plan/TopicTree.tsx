'use client'

import { useState, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronRight, Check, Minus } from 'lucide-react'
import { TOOL_CATALOG, getDomainLessons, getCategoryLessons, getTopicLessons } from '@/lib/content/tool-catalog'
import type { CatalogDomain, CatalogCategory, CatalogTopic, Lesson } from '@/lib/content/tool-catalog'

interface TopicTreeProps {
  onBuild: (selectedLessonIds: string[]) => void
  building?: boolean
}

// ─── Checkbox UI ──────────────────────────────────────────────────────────────

interface TreeCheckboxProps {
  checked: boolean
  indeterminate: boolean
  onChange: () => void
  label: string
  secondary?: string
}

function TreeCheckbox({ checked, indeterminate, onChange, label, secondary }: TreeCheckboxProps) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onChange() }}
      className="flex items-center gap-2 text-left group/cb min-w-0"
    >
      <span
        className={`w-4 h-4 rounded flex-shrink-0 flex items-center justify-center border transition-colors ${
          checked
            ? 'bg-[#7C3AED] border-[#7C3AED]'
            : indeterminate
            ? 'bg-[#7C3AED]/20 border-[#7C3AED]/60'
            : 'bg-transparent border-[#333333] group-hover/cb:border-[#555555]'
        }`}
      >
        {checked && <Check size={10} strokeWidth={3} className="text-white" />}
        {!checked && indeterminate && <Minus size={10} strokeWidth={3} className="text-[#A855F7]" />}
      </span>
      <span className="truncate text-inherit">{label}</span>
      {secondary && <span className="text-[#475569] text-xs flex-shrink-0">{secondary}</span>}
    </button>
  )
}

// ─── Lesson row ───────────────────────────────────────────────────────────────

function LessonRow({
  lesson,
  selected,
  onToggle,
}: {
  lesson: Lesson
  selected: boolean
  onToggle: (id: string) => void
}) {
  return (
    <div
      className={`flex items-center gap-3 py-2 px-3 rounded-lg transition-colors cursor-pointer ${
        selected ? 'bg-[#7C3AED]/10' : 'hover:bg-[#111111]'
      }`}
      onClick={() => onToggle(lesson.id)}
    >
      <span
        className={`w-3.5 h-3.5 rounded flex-shrink-0 flex items-center justify-center border transition-colors ${
          selected ? 'bg-[#7C3AED] border-[#7C3AED]' : 'bg-transparent border-[#333333] hover:border-[#555555]'
        }`}
      >
        {selected && <Check size={8} strokeWidth={3} className="text-white" />}
      </span>
      <span className={`text-sm flex-1 leading-tight ${selected ? 'text-white' : 'text-[#94A3B8]'}`}>
        {lesson.title}
      </span>
      <span className="text-[11px] text-[#475569] flex-shrink-0">{lesson.estimatedMinutes}m</span>
    </div>
  )
}

// ─── Topic row ────────────────────────────────────────────────────────────────

function TopicRow({
  topic,
  selected,
  expanded,
  onToggleExpand,
  onToggleSelect,
  onToggleLesson,
}: {
  topic: CatalogTopic
  selected: Set<string>
  expanded: boolean
  onToggleExpand: () => void
  onToggleSelect: () => void
  onToggleLesson: (id: string) => void
}) {
  const lessonIds = topic.lessons.map((l) => l.id)
  const checkedCount = lessonIds.filter((id) => selected.has(id)).length
  const allChecked = checkedCount === lessonIds.length
  const someChecked = checkedCount > 0 && !allChecked

  return (
    <div>
      <div
        className="flex items-center gap-2 py-2 px-3 rounded-lg cursor-pointer hover:bg-[#111111] transition-colors group"
        onClick={onToggleExpand}
      >
        <ChevronRight
          size={13}
          className={`flex-shrink-0 text-[#475569] transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
        <TreeCheckbox
          checked={allChecked}
          indeterminate={someChecked}
          onChange={onToggleSelect}
          label={topic.title}
          secondary={`${checkedCount}/${lessonIds.length}`}
        />
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            key="lessons"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="ml-8 space-y-0.5 py-1">
              {topic.lessons.map((lesson) => (
                <LessonRow
                  key={lesson.id}
                  lesson={lesson}
                  selected={selected.has(lesson.id)}
                  onToggle={onToggleLesson}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Category row ─────────────────────────────────────────────────────────────

function CategoryRow({
  category,
  selected,
  expandedTopics,
  onToggleCategory,
  onToggleTopic,
  onToggleLesson,
}: {
  category: CatalogCategory
  selected: Set<string>
  expandedTopics: Set<string>
  onToggleCategory: () => void
  onToggleTopic: (topicId: string) => void
  onToggleLesson: (lessonId: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const allLessons = getCategoryLessons(category)
  const checkedCount = allLessons.filter((l) => selected.has(l.id)).length
  const allChecked = checkedCount === allLessons.length
  const someChecked = checkedCount > 0 && !allChecked

  return (
    <div className="border-l border-[#1A1A1A] ml-4">
      <div
        className="flex items-center gap-2 py-2 px-3 rounded-lg cursor-pointer hover:bg-[#111111] transition-colors"
        onClick={() => setExpanded((e) => !e)}
      >
        <ChevronRight
          size={13}
          className={`flex-shrink-0 text-[#475569] transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
        <TreeCheckbox
          checked={allChecked}
          indeterminate={someChecked}
          onChange={onToggleCategory}
          label={category.title}
          secondary={`${checkedCount}/${allLessons.length}`}
        />
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            key="topics"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="ml-4 space-y-0.5 py-1">
              {category.topics.map((topic) => (
                <TopicRow
                  key={topic.id}
                  topic={topic}
                  selected={selected}
                  expanded={expandedTopics.has(topic.id)}
                  onToggleExpand={() => onToggleTopic(topic.id)}
                  onToggleSelect={() => {
                    const allSelected = getTopicLessons(topic).every((l) => selected.has(l.id))
                    getTopicLessons(topic).forEach((l) => {
                      if (allSelected) {
                        onToggleLesson(l.id) // will deselect if selected
                      } else if (!selected.has(l.id)) {
                        onToggleLesson(l.id) // select missing ones
                      }
                    })
                  }}
                  onToggleLesson={onToggleLesson}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Domain row ───────────────────────────────────────────────────────────────

function DomainRow({
  domain,
  selected,
  expandedTopics,
  onToggleDomain,
  onToggleCategory,
  onToggleTopic,
  onToggleLesson,
}: {
  domain: CatalogDomain
  selected: Set<string>
  expandedTopics: Set<string>
  onToggleDomain: (domainId: string) => void
  onToggleCategory: (domainId: string, categoryId: string) => void
  onToggleTopic: (topicId: string) => void
  onToggleLesson: (lessonId: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const allLessons = getDomainLessons(domain)
  const checkedCount = allLessons.filter((l) => selected.has(l.id)).length
  const allChecked = checkedCount === allLessons.length && allLessons.length > 0
  const someChecked = checkedCount > 0 && !allChecked

  return (
    <div className="rounded-xl border border-[#1E1E1E] bg-[#0A0A0A] overflow-hidden">
      {/* Domain header */}
      <div
        className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${
          expanded ? 'bg-[#111111]' : 'hover:bg-[#0F0F0F]'
        }`}
        onClick={() => setExpanded((e) => !e)}
      >
        <ChevronRight
          size={15}
          className={`flex-shrink-0 text-[#555555] transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
        />
        <span className="text-lg flex-shrink-0">{domain.emoji}</span>
        <TreeCheckbox
          checked={allChecked}
          indeterminate={someChecked}
          onChange={() => onToggleDomain(domain.id)}
          label={domain.title}
        />
        <div className="flex items-center gap-2 ml-auto flex-shrink-0">
          {someChecked || allChecked ? (
            <span className="text-xs font-semibold text-[#A855F7]">
              {checkedCount} selected
            </span>
          ) : (
            <span className="text-xs text-[#475569]">{allLessons.length} lessons</span>
          )}
        </div>
      </div>

      {/* Description */}
      {!expanded && (
        <div className="px-4 pb-3">
          <p className="text-xs text-[#475569] leading-relaxed">{domain.description}</p>
        </div>
      )}

      <AnimatePresence>
        {expanded && (
          <motion.div
            key="categories"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-1 pt-1">
              {domain.categories.map((category) => (
                <CategoryRow
                  key={category.id}
                  category={category}
                  selected={selected}
                  expandedTopics={expandedTopics}
                  onToggleCategory={() => onToggleCategory(domain.id, category.id)}
                  onToggleTopic={onToggleTopic}
                  onToggleLesson={onToggleLesson}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Main TopicTree ───────────────────────────────────────────────────────────

export function TopicTree({ onBuild, building = false }: TopicTreeProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [expandedTopics, setExpandedTopics] = useState<Set<string>>(new Set())

  const totalLessons = useMemo(
    () => TOOL_CATALOG.reduce((sum, d) => sum + getDomainLessons(d).length, 0),
    []
  )

  const selectedCount = selected.size

  const toggleLesson = useCallback((lessonId: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(lessonId)) next.delete(lessonId)
      else next.add(lessonId)
      return next
    })
  }, [])

  const toggleDomain = useCallback((domainId: string) => {
    const domain = TOOL_CATALOG.find((d) => d.id === domainId)
    if (!domain) return
    const all = getDomainLessons(domain)
    setSelected((prev) => {
      const next = new Set(prev)
      const allSelected = all.every((l) => next.has(l.id))
      all.forEach((l) => (allSelected ? next.delete(l.id) : next.add(l.id)))
      return next
    })
  }, [])

  const toggleCategory = useCallback((domainId: string, categoryId: string) => {
    const domain = TOOL_CATALOG.find((d) => d.id === domainId)
    const category = domain?.categories.find((c) => c.id === categoryId)
    if (!category) return
    const all = getCategoryLessons(category)
    setSelected((prev) => {
      const next = new Set(prev)
      const allSelected = all.every((l) => next.has(l.id))
      all.forEach((l) => (allSelected ? next.delete(l.id) : next.add(l.id)))
      return next
    })
  }, [])

  const toggleTopic = useCallback((topicId: string) => {
    setExpandedTopics((prev) => {
      const next = new Set(prev)
      if (next.has(topicId)) next.delete(topicId)
      else next.add(topicId)
      return next
    })
  }, [])

  const clearAll = () => setSelected(new Set())

  const totalMins = useMemo(() => {
    let mins = 0
    for (const domain of TOOL_CATALOG) {
      for (const l of getDomainLessons(domain)) {
        if (selected.has(l.id)) mins += l.estimatedMinutes
      }
    }
    return mins
  }, [selected])

  return (
    <div className="flex flex-col gap-4">
      {/* Sticky selection bar */}
      {selectedCount > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 rounded-xl bg-[#7C3AED]/15 border border-[#7C3AED]/30 backdrop-blur"
        >
          <div>
            <span className="text-sm font-semibold text-white">{selectedCount} lessons selected</span>
            <span className="text-xs text-[#94A3B8] ml-2">≈ {totalMins} min</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={clearAll}
              className="text-xs text-[#475569] hover:text-[#94A3B8] transition-colors"
            >
              Clear all
            </button>
            <button
              onClick={() => onBuild(Array.from(selected))}
              disabled={building}
              className="px-4 py-1.5 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-sm font-semibold transition-colors disabled:opacity-60"
            >
              {building ? 'Building...' : 'Build my path →'}
            </button>
          </div>
        </motion.div>
      )}

      {/* Domain list */}
      <div className="space-y-3">
        {TOOL_CATALOG.map((domain) => (
          <DomainRow
            key={domain.id}
            domain={domain}
            selected={selected}
            expandedTopics={expandedTopics}
            onToggleDomain={toggleDomain}
            onToggleCategory={toggleCategory}
            onToggleTopic={toggleTopic}
            onToggleLesson={toggleLesson}
          />
        ))}
      </div>

      {selectedCount === 0 && (
        <p className="text-center text-xs text-[#475569] py-4">
          Expand a domain and check the lessons you want — or tick the whole domain at once.
        </p>
      )}

      <p className="text-center text-xs text-[#333333]">{totalLessons} lessons across {TOOL_CATALOG.length} domains</p>
    </div>
  )
}
