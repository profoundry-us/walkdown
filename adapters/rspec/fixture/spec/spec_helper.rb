# frozen_string_literal: true

$LOAD_PATH.unshift File.expand_path('../../lib', __dir__) # walkdown-rspec gem lib
$LOAD_PATH.unshift File.expand_path('../lib', __dir__)    # fixture app lib

require 'walkdown/formatter'
require 'waitlist'
