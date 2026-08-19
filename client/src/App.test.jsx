import { render, screen } from '@testing-library/react';
import { describe, test, expect } from 'vitest';
import App from './App.jsx';

describe('App scaffold', () => {
  test('renders without crashing', () => {
    render(<App />);
    expect(screen.getByText('Kaeng')).toBeInTheDocument();
  });
});
