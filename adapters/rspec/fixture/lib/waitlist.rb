# frozen_string_literal: true

# The fixture "app": pure-Ruby waitlist logic mirroring the example project,
# so the formatter can be proven without a browser.
module Waitlist
  module_function

  def join(email)
    e = email.to_s.strip
    return { error: 'Please enter a valid email address.' } if e.empty? || !e.include?('@')

    { confirmation: "You're on the list! We'll email #{e}." }
  end
end
