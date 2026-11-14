import { defineCheck } from 'orca/testing'
import { cacheFixture, connectedStatus, emptyStatus } from './fixtures'

export default defineCheck({
  connect: {
    requests: {
      'mistral.status': emptyStatus
    }
  },
  connected: {
    requests: {
      'mistral.status': connectedStatus
    }
  },
  cache: {
    persisted: { plugin: { tab: 'cache' } },
    requests: {
      'mistral.status': connectedStatus,
      'mistral.cache': cacheFixture
    }
  }
})
