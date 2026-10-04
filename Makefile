NETWORKS := $(notdir $(wildcard networks/*))
DIST := $(NETWORKS:%=dist/%/metadata.json)

.SECONDEXPANSION:
dist: $(DIST)
# The directories are prerequisites so that deleting a file also triggers a rebuild.
dist/%/metadata.json: networks/%/sources.json $$(wildcard networks/$$*/snapshots/*.json) $(wildcard src/*.ts) bin/build.ts package-lock.json networks/$$*/snapshots src
	@mkdir -p $(@D)
	node bin/build.ts $* $@

clean:
	rm -rf dist

check:
	npx tsc --noEmit
	node --test 'test/**/*.test.ts'

.PHONY: dist clean check
