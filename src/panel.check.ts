import { defineCheck } from 'orca/testing'
import { connectedStatus, emptyStatus } from './fixtures'

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
  }
})
