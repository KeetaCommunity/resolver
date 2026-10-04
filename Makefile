.PHONY: check
check:
	npx tsc --noEmit
	node --test 'test/**/*.test.ts'
