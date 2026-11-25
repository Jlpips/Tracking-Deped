import { render, screen } from '@testing-library/react'
import App from './App'

describe('App', () => {
  it('renders the DTS Tracker title', () => {
    render(<App />)
    expect(screen.getByText('DTS Tracker')).toBeInTheDocument()
  })
})
