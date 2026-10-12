import assert from 'node:assert/strict'
import test from 'node:test'

// We test the logic of populateComposerWithTeamCommand directly with simulated DOM elements
function populateComposerWithTeamCommand(selectedMode, doc = globalThis.document) {
  const composer = doc.querySelector(
    '[data-composer-card] [contenteditable="true"][role="textbox"], [data-composer-card] textarea, textarea'
  )
  if (!composer) return false

  const modeFlag = selectedMode === 'economy' ? '--economy ' : ''
  const commandText = `/agent-teams ${modeFlag}`

  if ('value' in composer && typeof composer.value === 'string') {
    const textarea = composer
    const currentVal = textarea.value.trim()
    if (currentVal.startsWith('/agent-teams')) {
      textarea.value = currentVal.replace(/^\/agent-teams(\s+--economy|\s+--mode\s+\w+)?\s*/, commandText)
    } else {
      textarea.value = currentVal ? `${commandText}${currentVal}` : commandText
    }
    textarea.dispatchEvent({ type: 'input', bubbles: true })
  } else if (composer.isContentEditable) {
    const currentText = composer.textContent?.trim() ?? ''
    if (currentText.startsWith('/agent-teams')) {
      composer.textContent = currentText.replace(/^\/agent-teams(\s+--economy|\s+--mode\s+\w+)?\s*/, commandText)
    } else {
      composer.textContent = currentText ? `${commandText}${currentText}` : commandText
    }
    composer.dispatchEvent({ type: 'input', bubbles: true })
  }
  if (typeof composer.focus === 'function') composer.focus()
  return true
}

test('populateComposerWithTeamCommand: empty textarea with economy mode', () => {
  let focused = false
  const events = []
  const textarea = {
    value: '',
    focus() { focused = true },
    dispatchEvent(ev) { events.push(ev) },
  }
  const mockDoc = {
    querySelector(selector) {
      if (selector.includes('textarea')) return textarea
      return null
    },
  }

  const ok = populateComposerWithTeamCommand('economy', mockDoc)
  assert.equal(ok, true)
  assert.equal(textarea.value, '/agent-teams --economy ')
  assert.equal(focused, true)
  assert.equal(events.length, 1)
  assert.equal(events[0].type, 'input')
})

test('populateComposerWithTeamCommand: textarea with existing text in normal mode', () => {
  let focused = false
  const textarea = {
    value: 'build a landing page',
    focus() { focused = true },
    dispatchEvent() {},
  }
  const mockDoc = {
    querySelector: () => textarea,
  }

  populateComposerWithTeamCommand('normal', mockDoc)
  assert.equal(textarea.value, '/agent-teams build a landing page')
  assert.equal(focused, true)
})

test('populateComposerWithTeamCommand: mode toggle replaces existing command prefix', () => {
  const textarea = {
    value: '/agent-teams --economy write unit tests',
    focus() {},
    dispatchEvent() {},
  }
  const mockDoc = {
    querySelector: () => textarea,
  }

  populateComposerWithTeamCommand('normal', mockDoc)
  assert.equal(textarea.value, '/agent-teams write unit tests')

  populateComposerWithTeamCommand('economy', mockDoc)
  assert.equal(textarea.value, '/agent-teams --economy write unit tests')
})

test('populateComposerWithTeamCommand: contenteditable div handling', () => {
  let focused = false
  const div = {
    isContentEditable: true,
    textContent: 'inspect performance',
    focus() { focused = true },
    dispatchEvent() {},
  }
  const mockDoc = {
    querySelector: () => div,
  }

  populateComposerWithTeamCommand('economy', mockDoc)
  assert.equal(div.textContent, '/agent-teams --economy inspect performance')
  assert.equal(focused, true)
})

test('populateComposerWithTeamCommand: graceful no-op if no composer is in DOM', () => {
  const mockDoc = {
    querySelector: () => null,
  }

  const ok = populateComposerWithTeamCommand('economy', mockDoc)
  assert.equal(ok, false)
})
