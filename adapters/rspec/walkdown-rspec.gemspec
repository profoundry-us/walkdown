# frozen_string_literal: true

require_relative 'lib/walkdown/rspec/version'

Gem::Specification.new do |spec|
  spec.name = 'walkdown-rspec'
  spec.version = Walkdown::Rspec::VERSION
  spec.authors = ['Topher Fangio']
  spec.email = ['topher@profoundry.us']
  spec.summary = 'RSpec formatter that emits walkdown run records'
  spec.description = 'Tag RSpec examples with rule: metadata and this formatter appends a ' \
                     'walkdown run record (per-rule results, statement hashes, evidence) after each run.'
  spec.homepage = 'https://walkdown.dev'
  spec.license = 'MIT'
  spec.required_ruby_version = '>= 3.0'
  spec.files = Dir['lib/**/*.rb', 'README.md']
  spec.add_dependency 'rspec-core', '~> 3.0'
end
