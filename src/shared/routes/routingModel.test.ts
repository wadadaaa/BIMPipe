import { describe, expect, it } from 'vitest'
import { describeRoutingModel, resolveRoutingModel } from './routingModel'

describe('resolveRoutingModel', () => {
  it('uses branch runs outside demo mode', () => {
    expect(resolveRoutingModel({ enabled: false })).toBe('branch-runs')
  })

  it('keeps the legacy chains only for the demo runtime', () => {
    const demoRuntime = { enabled: true } as Parameters<typeof resolveRoutingModel>[0]
    expect(resolveRoutingModel(demoRuntime)).toBe('demo-chains')
  })

  it('describes the model for the Decisions panel', () => {
    expect(describeRoutingModel('branch-runs')).toBe('Routing model: branch runs (fixture → stack)')
    expect(describeRoutingModel('demo-chains')).toBe(
      'Routing model: demo chains (riser-to-riser sanitary routes)',
    )
  })
})
