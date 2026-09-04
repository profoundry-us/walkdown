# frozen_string_literal: true

require 'digest'
require 'etc'
require 'fileutils'
require 'json'
require 'rspec/core'
require 'rspec/core/formatters'
require 'shellwords'
require 'time'
require 'yaml'

# walkdown adapters for RSpec.
#
#   it "requires a guest email", rule: "checkout.guest.email-required" do ... end
#
#   rspec --format progress --format Walkdown::Formatter
#     appends a walkdown run record to <blueprint>/runs/ after the run.
#   rspec --dry-run --format Walkdown::ListFormatter
#     prints "rule:<id> <file>:<line>" per tagged example — the `runner.list`
#     command for walkdown lint's coverage check (RSpec's JSON formatter does
#     not include custom metadata, so this lister is the reliable source).
#
# Env: WALKDOWN_TARGET (default "local"), APP_HOST (base_url fallback;
# Capybara.app_host
# wins when Capybara is loaded). Who a run is recorded under is "ci" under CI
# and the `identity:` in ~/.walkdown/config.yml otherwise — never an env var.
# Evidence: set `evidence: [paths]` metadata on an example to attach files
# (screenshots your workflow specs saved).
#
# The formatter never fails a test run: any error is printed as a warning and
# the record is simply not written.
module Walkdown
  module Support
    module_function

    # Mirrors lib/hash.js: sha256 of the whitespace-normalized statement,
    # truncated to 12 hex chars behind a "sha256:" prefix.
    def statement_hash(statement)
      "sha256:#{Digest::SHA256.hexdigest(statement.to_s.gsub(/\s+/, ' ').strip)[0, 12]}"
    end

    # The home's runs/, given the blueprint directory inside it. A spec named
    # `blueprint` sits in its home; anything else is somebody's own layout and
    # keeps the sibling rule all the same.
    def runs_dir(blueprint_dir)
      File.join(File.dirname(File.expand_path(blueprint_dir)), 'runs')
    end

    def find_blueprint_dir(start = Dir.pwd)
      dir = File.expand_path(start)
      6.times do
        return dir if File.exist?(File.join(dir, 'walkdown.yml'))
        return File.join(dir, 'blueprint') if File.exist?(File.join(dir, 'blueprint', 'walkdown.yml'))

        parent = File.dirname(dir)
        break if parent == dir

        dir = parent
      end
      nil
    end

    def rules_by_id(blueprint_dir)
      rules = {}
      Dir.glob(File.join(blueprint_dir, 'features', '*.{yml,yaml}')).sort.each do |file|
        data = begin
          YAML.safe_load_file(file, aliases: true)
        rescue StandardError
          next
        end
        (data&.fetch('stories', nil) || []).each do |story|
          ((story || {}).fetch('rules', nil) || []).each do |rule|
            rules[rule['id']] = rule if rule.is_a?(Hash) && rule['id']
          end
        end
      end
      rules
    end

    def git_sha(dir)
      quoted = Shellwords.escape(dir)
      sha = `git -C #{quoted} rev-parse --short HEAD 2>/dev/null`.strip
      return nil if sha.empty?

      dirty = !`git -C #{quoted} status --porcelain 2>/dev/null`.strip.empty?
      dirty ? "#{sha}-dirty" : sha
    end
  end

  class Formatter
    RSpec::Core::Formatters.register self, :stop

    PRECEDENCE = %w[fail blocked pass skipped].freeze
    STATUS_MAP = { passed: 'pass', failed: 'fail', pending: 'skipped' }.freeze

    def initialize(output)
      @output = output
    end

    def stop(notification)
      record_run(notification.examples)
    rescue StandardError => e
      warn "walkdown formatter: #{e.class}: #{e.message} — run not recorded"
    end

    private

    def record_run(examples)
      dir = Support.find_blueprint_dir
      return warn('walkdown formatter: no blueprint (walkdown.yml) found — run not recorded') unless dir

      tagged = examples.select { |ex| ex.metadata[:rule] }
      return warn('walkdown formatter: no examples tagged rule: — run not recorded') if tagged.empty?

      results = aggregate(tagged, Support.rules_by_id(dir))
      file, record = write_record(dir, results)
      @output.puts "walkdown: recorded #{record['results'].length} rule result(s) → #{relative_to_pwd(file)}"
    end

    def aggregate(examples, rules)
      by_rule = {}
      examples.each do |ex|
        id = ex.metadata[:rule].to_s
        er = ex.execution_result
        status = STATUS_MAP.fetch(er.status, 'skipped')
        agg = by_rule[id] ||= { status: 'skipped', duration_ms: 0, checks: [], evidence: [], message: nil }
        agg[:status] = status if PRECEDENCE.index(status) < PRECEDENCE.index(agg[:status])
        agg[:duration_ms] += ((er.run_time || 0) * 1000).round
        check = check_ref(ex)
        agg[:checks] << check if check && !agg[:checks].include?(check)
        Array(ex.metadata[:evidence]).each { |path| agg[:evidence] << path unless agg[:evidence].include?(path) }
        if status == 'fail' && agg[:message].nil? && er.exception
          # RSpec expectation messages start with a newline — strip before taking the first line.
          agg[:message] = er.exception.message.to_s.strip.lines.first.to_s.strip[0, 200]
        end
      end

      by_rule.map do |id, agg|
        rule = rules[id]
        result = { 'rule' => id, 'status' => agg[:status] }
        if rule && rule['statement'] && %w[pass fail].include?(agg[:status])
          result['statement_hash'] = Support.statement_hash(rule['statement'])
        end
        result['duration_ms'] = agg[:duration_ms]
        result['checks'] = agg[:checks] unless agg[:checks].empty?
        result['evidence'] = agg[:evidence] unless agg[:evidence].empty?
        result['message'] = agg[:message] if agg[:message]
        result
      end
    end

    def check_ref(ex)
      path = ex.metadata[:file_path].to_s.sub(%r{\A\./}, '')
      return nil if path.empty?

      "#{path}:#{ex.metadata[:line_number]}"
    end

    # Where the runs go: BESIDE the blueprint, in the home that holds it.
    #
    # It used to be `<blueprint>/runs` - records kept inside the spec, the
    # layout every project had before homes. Nothing reads that now: a home is
    # `blueprint/` with threads, runs, evidence and drafts as siblings, and a
    # run filed inside the spec is a run `walkdown status` never sees.
    def write_record(dir, results)
      runs_dir = Support.runs_dir(dir)
      FileUtils.mkdir_p(runs_dir)
      now = Time.now.utc
      target = ENV['WALKDOWN_TARGET'] || 'local'
      prefix = "#{now.strftime('%Y-%m-%dT%H-%M-%SZ')}-#{target}-"
      seq = Dir.glob(File.join(runs_dir, "#{prefix}*")).length + 1
      run_id = format('%s%02d', prefix, seq)

      record = {
        'run_id' => run_id,
        'created' => now.strftime('%Y-%m-%dT%H:%M:%SZ'),
        'actor' => actor,
        'kind' => 'checks',
        'target' => target
      }
      record['base_url'] = base_url if base_url
      if (sha = Support.git_sha(dir))
        record['git_sha'] = sha
        record['blueprint_sha'] = sha
      end
      record['results'] = results

      file = File.join(runs_dir, "#{run_id}.json")
      File.write(file, JSON.pretty_generate(record) + "\n")
      [file, record]
    end

    # Who the run is recorded under. The personal config first, because it is
    # where a person has actually said who they are; a login name is what the
    # box is called. There used to be a WALKDOWN_ACTOR here, and an env var
    # that lets any caller type a name is not attribution (n-0139).
    def actor
      return 'ci' if ENV['CI']

      home = ENV['WALKDOWN_HOME'] || File.join(Dir.home, '.walkdown')
      config = File.join(home, 'config.yml')
      if File.exist?(config)
        said = (YAML.safe_load_file(config, aliases: true) || {}).dig('identity', 'username')
        return said.strip if said.is_a?(String) && !said.strip.empty?
      end
      Etc.getlogin || 'unknown'
    rescue StandardError
      Etc.getlogin || 'unknown'
    end

    def base_url
      capybara = defined?(Capybara) && Capybara.respond_to?(:app_host) ? Capybara.app_host : nil
      capybara || ENV['APP_HOST']
    end

    def relative_to_pwd(path)
      path.sub("#{Dir.pwd}/", '')
    end
  end

  class ListFormatter
    RSpec::Core::Formatters.register self, :stop

    def initialize(output)
      @output = output
    end

    def stop(notification)
      notification.examples.each do |ex|
        rule = ex.metadata[:rule]
        next unless rule

        path = ex.metadata[:file_path].to_s.sub(%r{\A\./}, '')
        @output.puts "rule:#{rule} #{path}:#{ex.metadata[:line_number]}"
      end
    end
  end
end
