import { describe, it, expect } from 'vitest'
import { ROW_CHOICES, guessRows, guessRowsFromHeaders, guessRowsFor, listNameFromFile } from '../../../../src/renderer/views/setup/rowWords'

const pick = (i: number | null) => (i === null ? null : ROW_CHOICES[i]!.many)

describe('a list name from the file name', () => {
  it.each([
    ['/home/me/caseload_export.xlsx', 'Caseload export'],
    ['C:\\Users\\me\\Downloads\\students-2026.csv', 'Students 2026'],
    ['/x/my   list__final.csv', 'My list final'],
    ['/x/.csv', ''],
  ])('%s → %s', (path, name) => {
    expect(listNameFromFile(path)).toBe(name)
  })

  it('caps it at 60 characters', () => {
    expect(listNameFromFile(`/x/${'a'.repeat(80)}.csv`)).toHaveLength(60)
  })
})

describe('what each line is, from the column names', () => {
  it.each([
    [['Student ID', 'Grade'], 'students'],
    [['Client name', 'Phone'], 'clients'],
    [['MRN', 'Ward'], 'patients'],
    [['VIN', 'Make', 'Model', 'Last service'], 'vehicles'],
    [['Unit', 'Tenant'], 'properties'],
    [['Employee', 'Start date'], 'staff'],
    [['Work order', 'Due'], 'jobs'],
    [['Name', 'Phone'], null],
  ])('%j → %s', (headers, many) => {
    expect(pick(guessRowsFromHeaders(headers))).toBe(many)
  })

  it('the list name wins over the headers; a generic name falls back to them', () => {
    expect(pick(guessRowsFor('Students', ['Client ID']).choice as number)).toBe('students')
    expect(pick(guessRowsFor('Caseload export', ['Client ID']).choice as number)).toBe('clients')
    expect(guessRowsFor('Tenants', ['Client ID']).suggested).toEqual({ one: 'tenant', many: 'tenants' })
    expect(guessRowsFor('Caseload export', ['Name']).choice).toBeNull()
  })

  it('guessRows still reads only the list name', () => {
    expect(pick(guessRows('Customers').choice as number)).toBe('customers')
    expect(guessRows('My caseload').choice).toBeNull()
  })
})
