export function parseLine(line: string): string[]
export function tempPassword(): string
export function keyProblem(key: string): string | null
export function readUsers(path: string): { row: number; email: string; name: string; password: string; problem: string | null }[]
